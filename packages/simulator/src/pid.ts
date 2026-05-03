/**
 * PID-IFB Controller for AID therapy mode.
 *
 * Rewritten to match v3 cgmsim-lib pid7smb.js faithfully:
 *
 *   rate = basalRate + (KP·e + KI·Σe + KD·ė×60) − 0.72·excessIOB
 *
 *   where excessIOB = max(0, totalIOB − equilibriumIOB)
 *   and   equilibriumIOB is the steady-state IOB for the current base basal rate.
 *
 * Key differences from the previous v4 implementation:
 *   - Feedback only on EXCESS IOB (not a multiplicative safety factor on the whole rate)
 *   - Gains: KP=0.012, KI=0.0008, KD=0.04 (derivative is multiplied ×60 inside the controller for U/hr)
 *   - Integral is a 2-hour sliding window sum (last 24 CGM errors), not an accumulator
 *   - Suspend at ≤70 mg/dL; minimum 0.1 U/hr above that threshold
 *   - Rate-of-change limited to 1 U/hr per 5-min tick
 *   - Microbolus rules from v3 supermicrobolus.js (rapid rise ≥2 mg/dL/min, sustained ≥1)
 */

import type { TherapyProfile } from '@cgmsim/shared';

const TICK_MINUTES = 5;

// Gains — matching v3 pid7smb.js
const KP = 0.012;
const KI = 0.0008;
const KD = 0.04;    // derivative is multiplied by 60 inside (per-hour conversion)
const INSULIN_FEEDBACK_GAIN = 0.72;

// Safety limits
const SUSPEND_THRESHOLD = 70;   // mg/dL: zero basal at or below this
const MIN_BASAL_RATE    = 0.1;  // U/hr: floor above suspend threshold
const MAX_BASAL_RATE    = 5.0;  // U/hr: ceiling
const MAX_RATE_CHANGE   = 1.0;  // U/hr per tick: rate-of-change limit
const MAX_HISTORY       = 24;   // readings = 2 hours at 5-min ticks (v3 uses 24)

// Microbolus — v3 supermicrobolus.js rules 1, 2, 3
const MB_MIN_GLUCOSE      = 100;   // mg/dL: no microbolus below this
const MB_RAPID_RATE       = 2.0;   // mg/dL/min → 0.2 U rapid-rise bolus (Rule 1)
const MB_SUSTAINED_RATE   = 1.0;   // mg/dL/min over 15 min → 0.15 U (Rule 2)
const MB_HIGH_THRESHOLD   = 130;   // mg/dL: prolonged-high trigger (Rule 3)
const MB_HIGH_TICKS       = 6;     // 30 min at 5-min ticks = 6 ticks of sustained high
const MB_HIGH_UNITS       = 0.1;   // U for prolonged high
const MB_MIN_TICKS        = 3;     // 15-min minimum interval between any microbolus

export interface PIDState {
  /** Last ≤24 CGM readings (oldest first, newest last). Used for integral term. */
  cgmHistory: number[];
  /** Basal rate delivered last tick (U/hr). Used for rate-of-change limiting. */
  prevRate: number;
  /** Ticks elapsed since last microbolus was given. Prevents rapid stacking. */
  ticksSinceLastMB: number;
}

export interface PIDOutput {
  rateUPerHour: number;
  microbolusUnits: number;
  nextState: PIDState;
}

/**
 * Equilibrium IOB at steady state for a constant basal infusion.
 *
 * Computed numerically — sums the IOB contribution of each 5-min micro-bolus
 * over one full DIA window using the same biexponential + 15-min ramp formula
 * used by calculatePumpBasalIOB. This matches the actual steady-state IOB that
 * the simulator accumulates, so excessIOB = max(0, actual - equilibrium) is
 * non-zero when there is genuinely excess insulin on board.
 *
 * The v3 analytical formula (auc = td*(1-a/2)) overestimates by ~2.4× because
 * it was tuned for a different IOB normalisation used in Nightscout-based loops.
 */
export function calculateEquilibriumIOB(
  basalRateUPerHour: number,
  diaHours: number,
  peakMin: number,
): number {
  const td  = diaHours * 60;
  const tau = (peakMin * (1 - peakMin / td)) / (1 - (2 * peakMin) / td);
  const a   = (2 * tau) / td;
  const S   = 1 / (1 - a + (1 + a) * Math.exp(-td / tau));
  const coeff = S * (1 - a);
  const tickUnits = basalRateUPerHour * TICK_MINUTES / 60;

  let iob = 0;
  for (let t = 0; t < td; t += TICK_MINUTES) {
    let frac = 1 - coeff * ((t * t / (tau * td * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
    if (t < 15) frac = 1 - (t / 15) * (1 - frac);
    iob += Math.max(0, frac) * tickUnits;
  }
  return iob;
}

/**
 * Run one tick of the PID-IFB controller.
 *
 * @param cgm               Current CGM reading (noisy, mg/dL)
 * @param iob               Total IOB — bolus + pump basal (units)
 * @param therapy           Current therapy profile
 * @param state             PID state from previous tick
 * @param basalRateUPerHour Scheduled basal rate for this tick (U/hr)
 * @param insulinPeak       Minutes to peak for the rapid analogue (from RAPID_PROFILES)
 */
export function runPID(
  cgm: number,
  iob: number,
  therapy: TherapyProfile,
  state: PIDState,
  basalRateUPerHour: number,
  insulinPeak: number,
): PIDOutput {
  const newHistory = pushHistory(state.cgmHistory, cgm);
  const newMBTicks = Math.min(state.ticksSinceLastMB + 1, 999);

  // ── Suspend: force zero basal at or below threshold ───────────────────────
  if (cgm <= SUSPEND_THRESHOLD) {
    return {
      rateUPerHour: 0,
      microbolusUnits: 0,
      nextState: { cgmHistory: newHistory, prevRate: 0, ticksSinceLastMB: newMBTicks },
    };
  }

  const target  = therapy.glucoseTarget;
  const prevCGM = state.cgmHistory.length > 0
    ? state.cgmHistory[state.cgmHistory.length - 1]!
    : cgm;

  // ── Error terms ───────────────────────────────────────────────────────────
  const error        = cgm - target;
  const derivative   = (cgm - prevCGM) / TICK_MINUTES;   // mg/dL per min
  // Integral: sum of last 24 CGM errors (2-hour window — matches v3)
  const integralError = state.cgmHistory.reduce((s, v) => s + (v - target), 0);

  // ── PID terms ─────────────────────────────────────────────────────────────
  const pTerm    = KP * error;
  const iTerm    = KI * integralError;
  const dTerm    = KD * derivative * 60;  // ×60: convert per-min derivative to per-hour (v3 does this)
  const pidDelta = pTerm + iTerm + dTerm;

  // ── Insulin feedback on EXCESS IOB only ───────────────────────────────────
  const equilibriumIOB = calculateEquilibriumIOB(basalRateUPerHour, therapy.rapidDia, insulinPeak);
  const excessIOB      = Math.max(0, iob - equilibriumIOB);
  const feedbackTerm   = INSULIN_FEEDBACK_GAIN * excessIOB;

  const rawRate = basalRateUPerHour + pidDelta - feedbackTerm;

  // ── Safety limits ─────────────────────────────────────────────────────────
  let finalRate = Math.max(MIN_BASAL_RATE, Math.min(MAX_BASAL_RATE, rawRate));

  // Rate-of-change limit: no more than 1 U/hr change per tick
  const rateDelta = finalRate - state.prevRate;
  if (Math.abs(rateDelta) > MAX_RATE_CHANGE) {
    finalRate = state.prevRate + Math.sign(rateDelta) * MAX_RATE_CHANGE;
  }

  // Round to 0.05 U/hr (pump resolution — matches v3 finalizeBasalRate)
  finalRate = Math.round(finalRate * 20) / 20;

  // ── Supermicrobolus (v3 supermicrobolus.js rules 1, 2, 3) — optional ─────
  let microbolusUnits = 0;
  if (therapy.enableSMB && cgm >= MB_MIN_GLUCOSE && newMBTicks >= MB_MIN_TICKS) {
    const riseRate = (cgm - prevCGM) / TICK_MINUTES;

    if (state.cgmHistory.length >= 1 && riseRate >= MB_RAPID_RATE) {
      // Rule 1: rapid rise ≥ 2 mg/dL/min
      microbolusUnits = 0.2;
    } else if (state.cgmHistory.length >= 3 && riseRate >= MB_SUSTAINED_RATE) {
      // Rule 2: sustained rise ≥ 1 mg/dL/min over 15 min
      const cgmMinus15 = state.cgmHistory[state.cgmHistory.length - 3]!;
      if ((cgm - cgmMinus15) / 15 >= MB_SUSTAINED_RATE) microbolusUnits = 0.15;
    } else if (
      cgm >= MB_HIGH_THRESHOLD &&
      state.cgmHistory.length >= MB_HIGH_TICKS &&
      state.cgmHistory.slice(-MB_HIGH_TICKS).every(v => v >= MB_HIGH_THRESHOLD) &&
      (cgm - prevCGM) / TICK_MINUTES > -2.0   // not already dropping rapidly
    ) {
      // Rule 3: prolonged high — BG ≥ 130 for 30+ min and not in rapid descent
      microbolusUnits = MB_HIGH_UNITS;
    }
  }

  const ticksSinceLastMB = microbolusUnits > 0 ? 0 : newMBTicks;

  return {
    rateUPerHour: finalRate,
    microbolusUnits,
    nextState: { cgmHistory: newHistory, prevRate: finalRate, ticksSinceLastMB },
  };
}

function pushHistory(history: number[], value: number): number[] {
  const trimmed = history.length >= MAX_HISTORY ? history.slice(1) : history;
  return [...trimmed, value];
}

/**
 * Convert AID basal rate to a 5-minute micro-bolus equivalent.
 */
export function rateToMicroBolus(rateUPerHour: number): number {
  return rateUPerHour * (TICK_MINUTES / 60);
}

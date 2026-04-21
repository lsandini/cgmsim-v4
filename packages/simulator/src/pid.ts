/**
 * PID Controller for AID therapy mode.
 *
 * Ported from @lsandini/cgmsim-lib PID controller implementation.
 * Receives the noisy CGM signal (not true glucose) — physiologically accurate
 * and pedagogically important (controller reacts to sensor artefacts).
 *
 * Includes a fuzzy-logic microbolus layer that adds small correction boluses
 * when both PID output and glucose trajectory agree a bolus is warranted.
 *
 * Returns the insulin delivery rate for this tick in U/hr.
 */

import type { TherapyProfile } from '@cgmsim/shared';

export interface PIDState {
  integral: number;
  prevCGM: number;
}

export interface PIDOutput {
  rateUPerHour: number;
  /** Updated PID state to store back into WorkerState. */
  nextState: PIDState;
  /** Microbolus delivered this tick (units), if any. */
  microbolusUnits: number;
}

const TICK_MINUTES = 1;
const TICK_HOURS = TICK_MINUTES / 60;

// PID tuning constants — matching v3 values
const KP = 0.005; // Proportional gain (U/hr per mg/dL error)
const KI = 0.0001; // Integral gain (U/hr per mg/dL·min)
const KD = 0.01;  // Derivative gain (U/hr per (mg/dL/min))

// Safety limits
const MAX_RATE_U_PER_HOUR = 5.0;
const MIN_RATE_U_PER_HOUR = 0.0;
const MAX_INTEGRAL = 500;  // Cap integral accumulation (mg/dL·min)
const MIN_INTEGRAL = -200;

// Fuzzy microbolus thresholds
const MICROBOLUS_CGM_THRESHOLD = 140;  // mg/dL: only bolus above this
const MICROBOLUS_TREND_THRESHOLD = 1;  // mg/dL/min: only bolus when rising
const MICROBOLUS_MAX_UNITS = 0.3;      // Max microbolus per tick

/**
 * Run one tick of the PID controller.
 *
 * @param cgm           Current CGM reading (noisy, mg/dL)
 * @param iob           Current IOB (units)
 * @param therapy       Current therapy profile (for target and programmed ISF)
 * @param state         PID state from previous tick
 * @param basalRateUPerHour  Current scheduled basal rate (U/hr)
 */
export function runPID(
  cgm: number,
  iob: number,
  therapy: TherapyProfile,
  state: PIDState,
  basalRateUPerHour: number,
): PIDOutput {
  const target = therapy.glucoseTarget;
  const error = cgm - target; // positive = above target → need more insulin

  // Derivative: rate of change per minute
  const dCGM = (cgm - state.prevCGM) / TICK_MINUTES;

  // Integral: accumulate error × tick duration
  const newIntegral = Math.max(
    MIN_INTEGRAL,
    Math.min(MAX_INTEGRAL, state.integral + error * TICK_MINUTES),
  );

  // PID output (additive adjustment above scheduled basal)
  const pidAdjustment =
    KP * error +
    KI * newIntegral +
    KD * dCGM;

  // Total rate = scheduled basal + PID adjustment
  const rawRate = basalRateUPerHour + pidAdjustment;

  // Clamp and apply IOB safety: reduce if IOB is already high
  const iobSafetyFactor = Math.max(0, 1 - iob / 5);
  const clampedRate = Math.max(
    MIN_RATE_U_PER_HOUR,
    Math.min(MAX_RATE_U_PER_HOUR, rawRate * iobSafetyFactor),
  );

  // ── Fuzzy microbolus layer ──────────────────────────────────────────────
  let microbolusUnits = 0;
  if (
    cgm > MICROBOLUS_CGM_THRESHOLD &&
    dCGM > MICROBOLUS_TREND_THRESHOLD &&
    iob < 2.0
  ) {
    // Microbolus proportional to error above threshold, capped
    const fuzzyAmount = Math.min(
      MICROBOLUS_MAX_UNITS,
      (cgm - MICROBOLUS_CGM_THRESHOLD) / therapy.programmedISF * 0.3,
    );
    microbolusUnits = Math.max(0, fuzzyAmount);
  }

  return {
    rateUPerHour: clampedRate,
    nextState: { integral: newIntegral, prevCGM: cgm },
    microbolusUnits,
  };
}

/**
 * Convert AID basal rate to a 5-minute micro-bolus equivalent.
 * Pump delivers basal as micro-boluses every TICK_MINUTES.
 */
export function rateToMicroBolus(rateUPerHour: number): number {
  return rateUPerHour * TICK_HOURS;
}

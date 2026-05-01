/**
 * CGMSIM v4 — WebWorker Simulation Engine
 *
 * This worker owns all simulation state. It is the only component that
 * runs the physiological model. The main thread communicates exclusively
 * through the typed postMessage interface defined in @cgmsim/shared.
 *
 * Architecture (per spec §7.1):
 *   - Long-lived; resets via RESET message rather than re-creation
 *   - No network access
 *   - Tick loop driven by setInterval at interval = 300_000ms / throttle
 *   - One CGM reading produced per tick (5 simulated minutes)
 */

import type {
  WorkerState,
  WorkerInboundMessage,
  WorkerOutboundMessage,
  TickSnapshot,
  StateSavedMessage,
  ActiveBolus,
  ActiveMeal,
  G6NoiseState,
} from '@cgmsim/shared';
import {
  DEFAULT_PATIENT,
  DEFAULT_THERAPY_PROFILE,
} from '@cgmsim/shared';

import { DexcomG6Noise, createG6NoiseGenerator } from './g6Noise.js';
import { computeDeltaBG } from './deltaBG.js';
import { calculateBolusIOB, calculateLongActingIOB, calculatePumpBasalIOB } from './iob.js';
import { calculateCOB, purgeAbsorbedMeals, resolveMealSplit } from './carbs.js';
import type { ResolvedMeal } from './carbs.js';
import { runPID, rateToMicroBolus } from './pid.js';
import type { PIDState } from './pid.js';
import type { PumpBasalBolus } from './iob.js';
import { RAPID_PROFILES } from './insulinProfiles.js';

// ── Constants ────────────────────────────────────────────────────────────────

const TICK_SIM_MINUTES = 5;
const TICK_SIM_MS = TICK_SIM_MINUTES * 60_000;
const INITIAL_GLUCOSE_MG_DL = 100;
const DEFAULT_THROTTLE = 10;
const DEFAULT_NOISE_SEED = 42;

// ── Worker state ─────────────────────────────────────────────────────────────

// Extended state used internally (resolvedMeals not in WorkerState schema)
interface InternalState {
  core: WorkerState;
  resolvedMeals: ResolvedMeal[];
  pumpMicroBoluses: PumpBasalBolus[];
  g6: DexcomG6Noise;
  intervalId: ReturnType<typeof setInterval> | null;
  // Seeded RNG for meal carb splits (simple LCG for reproducibility)
  rngState: number;
}

// ── Simple seeded LCG for reproducible random splits ─────────────────────────

function lcgNext(state: number): { value: number; nextState: number } {
  const next = (1664525 * state + 1013904223) & 0xffffffff;
  return { value: (next >>> 0) / 0xffffffff, nextState: next };
}

// ── State initialisation ──────────────────────────────────────────────────────

function createInitialCoreState(): WorkerState {
  return {
    simTimeMs: 0,
    trueGlucose: INITIAL_GLUCOSE_MG_DL,
    lastCGM: INITIAL_GLUCOSE_MG_DL,
    patient: { ...DEFAULT_PATIENT },
    therapy: { ...DEFAULT_THERAPY_PROFILE, basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }] },
    g6State: {
      v: [0, 0],
      cc: [0, 0],
      tCalib: 0,  // simulation epoch — not wall-clock time
      rng: { jsr: 123456789 ^ DEFAULT_NOISE_SEED, seed: DEFAULT_NOISE_SEED },
    },
    activeBoluses: [],
    activeMeals: [],
    activeLongActing: [],
    pidCGMHistory: [],
    pidPrevRate: 0.8,
    pidTicksSinceLastMB: 999,
    throttle: DEFAULT_THROTTLE,
    running: false,
  };
}

const internal: InternalState = {
  core: createInitialCoreState(),
  resolvedMeals: [],
  pumpMicroBoluses: [],
  g6: createG6NoiseGenerator(DEFAULT_NOISE_SEED, null),
  intervalId: null,
  rngState: DEFAULT_NOISE_SEED,
};

// ── Basal rate lookup ─────────────────────────────────────────────────────────

function getCurrentBasalRate(simTimeMs: number): number {
  const minuteOfDay = (simTimeMs / 60_000) % (24 * 60);
  const profile = internal.core.therapy.basalProfile;

  // Find the last entry whose timeMinutes <= minuteOfDay
  let rate = profile[0]?.rateUPerHour ?? 0.8;
  for (const entry of profile) {
    if (entry.timeMinutes <= minuteOfDay) {
      rate = entry.rateUPerHour;
    }
  }
  return rate;
}

// ── Tick function ─────────────────────────────────────────────────────────────

function tick(): void {
  const s = internal.core;
  const nowMs = s.simTimeMs;
  const isPump = s.therapy.mode === 'PUMP' || s.therapy.mode === 'AID';

  // 1. Purge expired treatments
  s.activeBoluses = s.activeBoluses.filter(
    (b) => (nowMs - b.simTimeMs) / 60_000 <= b.dia * 60,
  );
  s.activeLongActing = s.activeLongActing.filter((d) =>
    (nowMs - d.simTimeMs) / 60_000 <= d.duration
  );
  internal.resolvedMeals = purgeAbsorbedMeals(
    internal.resolvedMeals, s.patient.carbsAbsTime, nowMs,
  );
  internal.pumpMicroBoluses = internal.pumpMicroBoluses.filter(
    (mb) => (nowMs - mb.simTimeMs) / 60_000 <= mb.dia * 60,
  );

  // 2. AID controller fires on current CGM (noisy), not true glucose
  let currentBasalRate = getCurrentBasalRate(nowMs);
  let microbolusUnits = 0;

  if (s.therapy.mode === 'AID') {
    const totalIOB = calculateBolusIOB(s.activeBoluses, nowMs)
      + calculatePumpBasalIOB(internal.pumpMicroBoluses, nowMs);
    const rp = RAPID_PROFILES[s.therapy.rapidAnalogue];
    const pidState: PIDState = {
      cgmHistory: s.pidCGMHistory,
      prevRate: s.pidPrevRate,
      ticksSinceLastMB: s.pidTicksSinceLastMB,
    };
    const pidResult = runPID(
      s.lastCGM, totalIOB, s.therapy, pidState, currentBasalRate, rp?.peak ?? 55,
    );
    currentBasalRate = pidResult.rateUPerHour;
    s.pidCGMHistory = pidResult.nextState.cgmHistory;
    s.pidPrevRate = pidResult.nextState.prevRate;
    s.pidTicksSinceLastMB = pidResult.nextState.ticksSinceLastMB;
    microbolusUnits = pidResult.microbolusUnits;

    // Record AID micro-bolus in active boluses for IOB accounting
    if (microbolusUnits > 0) {
      s.activeBoluses.push({
        id: `mb-${nowMs}`,
        simTimeMs: nowMs,
        units: microbolusUnits,
        analogue: s.therapy.rapidAnalogue,
        dia: s.patient.dia,
      });
    }
  }

  // 3. Add scheduled pump micro-bolus for this tick
  if (isPump) {
    const rapidProfile = RAPID_PROFILES[s.therapy.rapidAnalogue];
    if (rapidProfile) {
      const microBolusUnits = rateToMicroBolus(currentBasalRate);
      if (microBolusUnits > 0) {
        internal.pumpMicroBoluses.push({
          simTimeMs: nowMs,
          units: microBolusUnits,
          dia: s.patient.dia,
          peak: rapidProfile.peak,
        });
      }
    }
  }

  // 4. Compute deltaBG
  const delta = computeDeltaBG({
    patient: s.patient,
    isf: s.patient.trueISF,
    cr: s.patient.trueCR,
    boluses: s.activeBoluses,
    longActing: s.activeLongActing,
    pumpMicroBoluses: internal.pumpMicroBoluses,
    meals: internal.resolvedMeals,
    nowSimTimeMs: nowMs,
    isPump,
    currentGlucose: s.trueGlucose,
  });

  // 5. Apply deltaBG to true glucose, clamp to physiological limits
  const newTrueGlucose = Math.max(20, Math.min(600, s.trueGlucose + delta.deltaBG));

  // 6. Apply G6 sensor noise
  const noisyCGM = internal.g6.applySensorModel(newTrueGlucose, nowMs);
  const cgmReading = Math.max(40, Math.min(400, Math.round(noisyCGM)));

  // 7. Compute IOB / COB for snapshot
  const iob =
    calculateBolusIOB(s.activeBoluses, nowMs) +
    (isPump
      ? calculatePumpBasalIOB(internal.pumpMicroBoluses, nowMs)
      : calculateLongActingIOB(s.activeLongActing, nowMs));

  const cob = calculateCOB(internal.resolvedMeals, s.patient.carbsAbsTime, nowMs);

  // 8. Advance simulation time
  const nextSimTimeMs = nowMs + TICK_SIM_MS;

  // 9. Update state
  s.trueGlucose = newTrueGlucose;
  s.lastCGM = cgmReading;
  s.g6State = internal.g6.getState();
  s.simTimeMs = nextSimTimeMs;

  // 10. Post tick snapshot to main thread
  const snapshot: TickSnapshot = {
    type: 'TICK',
    simTimeMs: nextSimTimeMs,
    cgm: cgmReading,
    trueGlucose: newTrueGlucose,
    iob: Math.round(iob * 100) / 100,
    cob: Math.round(cob * 10) / 10,
    deltaMinutes: 5,
    trend: delta.deltaBG / TICK_SIM_MINUTES, // mg/dL per minute
    basalRate: currentBasalRate,
  };

  (self as unknown as Worker).postMessage(snapshot);
}

// ── setInterval management ────────────────────────────────────────────────────

function startInterval(): void {
  if (internal.intervalId !== null) {
    clearInterval(internal.intervalId);
  }
  const intervalMs = 300_000 / internal.core.throttle;
  internal.intervalId = setInterval(tick, intervalMs);
  internal.core.running = true;
}

function stopInterval(): void {
  if (internal.intervalId !== null) {
    clearInterval(internal.intervalId);
    internal.intervalId = null;
  }
  internal.core.running = false;
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'BOLUS': {
      const analogue = msg.analogue ?? internal.core.therapy.rapidAnalogue;
      internal.core.activeBoluses.push({
        id: `bolus-${internal.core.simTimeMs}-${Math.random().toString(36).slice(2)}`,
        simTimeMs: internal.core.simTimeMs,
        units: msg.units,
        analogue,
        dia: internal.core.patient.dia,
      });
      break;
    }

    case 'MEAL': {
      const meal: ActiveMeal = {
        id: `meal-${internal.core.simTimeMs}-${Math.random().toString(36).slice(2)}`,
        simTimeMs: internal.core.simTimeMs,
        carbsG: msg.carbsG,
        gastricEmptyingRate: msg.gastricEmptyingRate ?? internal.core.patient.gastricEmptyingRate,
      };
      // Advance LCG for reproducible split
      const { value: rand, nextState } = lcgNext(internal.rngState);
      internal.rngState = nextState;
      internal.resolvedMeals.push(resolveMealSplit(meal, rand));
      internal.core.activeMeals.push(meal);
      break;
    }

    case 'SET_BASAL': {
      // Simple override: replace first entry (Phase 2 will handle temp basals properly)
      internal.core.therapy.basalProfile = [
        { timeMinutes: 0, rateUPerHour: msg.rateUPerHour },
      ];
      break;
    }

    case 'SET_TARGET': {
      internal.core.therapy.glucoseTarget = msg.targetMgdL;
      break;
    }

    case 'SET_PATIENT_PARAM': {
      Object.assign(internal.core.patient, msg.patch);
      break;
    }

    case 'SET_THERAPY_PARAM': {
      Object.assign(internal.core.therapy, msg.patch);
      break;
    }

    case 'SET_THROTTLE': {
      internal.core.throttle = msg.throttle;
      if (internal.core.running) {
        startInterval(); // Restart at new interval
      }
      break;
    }

    case 'PAUSE': {
      stopInterval();
      break;
    }

    case 'RESUME': {
      startInterval();
      // Fire one tick immediately so the UI responds instantly
      tick();
      break;
    }

    case 'SAVE_STATE': {
      const saved: StateSavedMessage = {
        type: 'STATE_SAVED',
        state: {
          ...internal.core,
          g6State: internal.g6.getState(),
        },
      };
      (self as unknown as Worker).postMessage(saved);
      break;
    }

    case 'RESET': {
      stopInterval();
      internal.core = { ...msg.state };
      internal.resolvedMeals = [];
      internal.pumpMicroBoluses = [];
      internal.g6 = createG6NoiseGenerator(DEFAULT_NOISE_SEED, msg.state.g6State);
      internal.rngState = DEFAULT_NOISE_SEED;
      break;
    }
  }
});

// ── Auto-start ────────────────────────────────────────────────────────────────
// Worker starts paused; the main thread sends RESUME to begin.

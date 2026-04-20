/**
 * InlineSimulator — runs the entire simulation on the main thread.
 *
 * Replaces the WebWorker architecture for the standalone HTML build.
 * Uses setTimeout for the tick loop so the UI stays responsive.
 * Exposes the same API as WorkerBridge so main.ts is unchanged.
 *
 * This eliminates all blob-Worker/CSP issues for the standalone file.
 */

import type {
  TickSnapshot,
  WorkerState,
  RapidAnalogueType,
  VirtualPatient,
  TherapyProfile,
} from '@cgmsim/shared';
import { DEFAULT_PATIENT, DEFAULT_THERAPY_PROFILE } from '@cgmsim/shared';

import { DexcomG6Noise, createG6NoiseGenerator } from '../../simulator/src/g6Noise.js';
import { computeDeltaBG } from '../../simulator/src/deltaBG.js';
import { calculateBolusIOB, calculateLongActingIOB, calculatePumpBasalIOB } from '../../simulator/src/iob.js';
import { calculateCOB, purgeAbsorbedMeals, resolveMealSplit } from '../../simulator/src/carbs.js';
import type { ResolvedMeal } from '../../simulator/src/carbs.js';
import { runPID, rateToMicroBolus } from '../../simulator/src/pid.js';
import { RAPID_PROFILES, LONG_ACTING_PROFILES } from '../../simulator/src/insulinProfiles.js';
import type { PumpBasalBolus } from '../../simulator/src/iob.js';
import type { ActiveBolus, ActiveMeal } from '@cgmsim/shared';

// ── Constants ────────────────────────────────────────────────────────────────

const TICK_SIM_MS   = 5 * 60_000;
const DEFAULT_SEED  = 42;
const INITIAL_BG    = 100;

// ── LCG for reproducible meal splits ─────────────────────────────────────────

function lcgNext(s: number): { value: number; nextState: number } {
  const n = (1664525 * s + 1013904223) & 0xffffffff;
  return { value: (n >>> 0) / 0xffffffff, nextState: n };
}

// ── Simulator state ───────────────────────────────────────────────────────────

interface SimState {
  simTimeMs: number;
  trueGlucose: number;
  lastCGM: number;
  patient: VirtualPatient;
  therapy: TherapyProfile;
  activeBoluses: ActiveBolus[];
  activeMeals: ActiveMeal[];
  resolvedMeals: ResolvedMeal[];
  pumpMicroBoluses: PumpBasalBolus[];
  pidIntegral: number;
  pidPrevCGM: number;
  throttle: number;
  running: boolean;
  g6: DexcomG6Noise;
  rngState: number;
}

function createInitialState(): SimState {
  return {
    simTimeMs:       0,
    trueGlucose:     INITIAL_BG,
    lastCGM:         INITIAL_BG,
    patient:         { ...DEFAULT_PATIENT },
    therapy:         { ...DEFAULT_THERAPY_PROFILE, basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }] },
    activeBoluses:   [],
    activeMeals:     [],
    resolvedMeals:   [],
    pumpMicroBoluses: [],
    pidIntegral:     0,
    pidPrevCGM:      INITIAL_BG,
    throttle:        10,
    running:         false,
    g6:              createG6NoiseGenerator(DEFAULT_SEED, null),
    rngState:        DEFAULT_SEED,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TickHandler  = (snap: TickSnapshot) => void;
type SavedHandler = (state: WorkerState) => void;

// ── InlineSimulator ───────────────────────────────────────────────────────────

export class InlineSimulator {
  private state: SimState = createInitialState();
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private tickHandlers:  TickHandler[]  = [];
  private savedHandlers: SavedHandler[] = [];

  onTick(h: TickHandler):  void { this.tickHandlers.push(h); }
  onStateSaved(h: SavedHandler): void { this.savedHandlers.push(h); }

  // ── Tick ──────────────────────────────────────────────────────────────────

  private tick(): void {
    const s = this.state;
    const nowMs  = s.simTimeMs;
    const isPump = s.therapy.mode === 'PUMP' || s.therapy.mode === 'AID';

    // Purge expired
    const diaMin = s.patient.dia * 60;
    s.activeBoluses = s.activeBoluses.filter(b => (nowMs - b.simTimeMs) / 60_000 <= diaMin);
    s.activeLongActing = (s as any).activeLongActing?.filter((d: any) => {
      const p = LONG_ACTING_PROFILES[d.type as keyof typeof LONG_ACTING_PROFILES];
      return p ? (nowMs - d.simTimeMs) / 60_000 <= p.dia * 60 : false;
    }) ?? [];
    s.resolvedMeals    = purgeAbsorbedMeals(s.resolvedMeals, s.patient.carbsAbsTime, nowMs);
    s.pumpMicroBoluses = s.pumpMicroBoluses.filter(mb => (nowMs - mb.simTimeMs) / 60_000 <= mb.dia * 60);

    // AID controller
    let basalRate = this.getBasalRate(nowMs);
    if (s.therapy.mode === 'AID') {
      const pid = runPID(
        s.lastCGM,
        calculateBolusIOB(s.activeBoluses, nowMs),
        s.therapy,
        { integral: s.pidIntegral, prevCGM: s.pidPrevCGM },
        basalRate,
      );
      basalRate      = pid.rateUPerHour;
      s.pidIntegral  = pid.nextState.integral;
      s.pidPrevCGM   = pid.nextState.prevCGM;
      if (pid.microbolusUnits > 0) {
        s.activeBoluses.push({
          id: `mb-${nowMs}`, simTimeMs: nowMs,
          units: pid.microbolusUnits, analogue: s.therapy.rapidAnalogue,
        });
      }
    }

    // Pump micro-bolus
    if (isPump) {
      const rp = RAPID_PROFILES[s.therapy.rapidAnalogue];
      if (rp) {
        const u = rateToMicroBolus(basalRate);
        if (u > 0) s.pumpMicroBoluses.push({ simTimeMs: nowMs, units: u, dia: rp.dia, peak: rp.peak });
      }
    }

    // deltaBG
    const delta = computeDeltaBG({
      patient: s.patient, isf: s.patient.trueISF, cr: s.patient.trueCR,
      boluses: s.activeBoluses, longActing: (s as any).activeLongActing ?? [],
      pumpMicroBoluses: s.pumpMicroBoluses, meals: s.resolvedMeals,
      nowSimTimeMs: nowMs, isPump,
    });

    // Apply
    const newTrue = Math.max(20, Math.min(600, s.trueGlucose + delta.deltaBG));
    const noisy   = s.g6.applySensorModel(newTrue, nowMs);
    const cgm     = Math.max(40, Math.min(400, Math.round(noisy)));

    // IOB / COB
    const iob = calculateBolusIOB(s.activeBoluses, nowMs) +
      (isPump
        ? calculatePumpBasalIOB(s.pumpMicroBoluses, nowMs)
        : calculateLongActingIOB((s as any).activeLongActing ?? [], nowMs));
    const cob = calculateCOB(s.resolvedMeals, s.patient.carbsAbsTime, nowMs);

    // Advance
    s.trueGlucose = newTrue;
    s.lastCGM     = cgm;
    s.simTimeMs   = nowMs + TICK_SIM_MS;

    // Post snapshot
    const snap: TickSnapshot = {
      type: 'TICK', simTimeMs: s.simTimeMs, cgm, trueGlucose: newTrue,
      iob: Math.round(iob * 100) / 100, cob: Math.round(cob * 10) / 10,
      deltaMinutes: 5, trend: delta.deltaBG / 5, basalRate,
    };
    for (const h of this.tickHandlers) h(snap);
  }

  private getBasalRate(simTimeMs: number): number {
    const minuteOfDay = (simTimeMs / 60_000) % (24 * 60);
    const profile = this.state.therapy.basalProfile;
    let rate = profile[0]?.rateUPerHour ?? 0.8;
    for (const e of profile) if (e.timeMinutes <= minuteOfDay) rate = e.rateUPerHour;
    return rate;
  }

  // ── Timer management ──────────────────────────────────────────────────────

  private scheduleNext(): void {
    if (!this.state.running) return;
    const interval = 300_000 / this.state.throttle;
    this.timerId = setTimeout(() => {
      this.tick();
      this.scheduleNext();
    }, interval);
  }

  private clearTimer(): void {
    if (this.timerId !== null) { clearTimeout(this.timerId); this.timerId = null; }
  }

  // ── Public API (mirrors WorkerBridge) ─────────────────────────────────────

  resume(): void {
    this.state.running = true;
    this.tick();          // fire immediately
    this.scheduleNext();
  }

  pause(): void {
    this.state.running = false;
    this.clearTimer();
  }

  setThrottle(throttle: number): void {
    this.state.throttle = throttle;
    if (this.state.running) { this.clearTimer(); this.scheduleNext(); }
  }

  bolus(units: number, analogue?: RapidAnalogueType): void {
    this.state.activeBoluses.push({
      id: `bolus-${this.state.simTimeMs}-${Math.random().toString(36).slice(2)}`,
      simTimeMs: this.state.simTimeMs, units,
      analogue: analogue ?? this.state.therapy.rapidAnalogue,
    });
  }

  meal(carbsG: number, gastricEmptyingRate?: number): void {
    const meal: ActiveMeal = {
      id: `meal-${this.state.simTimeMs}-${Math.random().toString(36).slice(2)}`,
      simTimeMs: this.state.simTimeMs, carbsG,
      gastricEmptyingRate: gastricEmptyingRate ?? this.state.patient.gastricEmptyingRate,
    };
    const { value, nextState } = lcgNext(this.state.rngState);
    this.state.rngState = nextState;
    this.state.resolvedMeals.push(resolveMealSplit(meal, value));
    this.state.activeMeals.push(meal);
  }

  setTarget(targetMgdL: number): void {
    this.state.therapy.glucoseTarget = targetMgdL;
  }

  setPatientParam(patch: Partial<VirtualPatient>): void {
    Object.assign(this.state.patient, patch);
  }

  setTherapyParam(patch: Partial<TherapyProfile>): void {
    Object.assign(this.state.therapy, patch);
    if (patch.basalProfile) {
      this.state.therapy.basalProfile = patch.basalProfile;
    }
  }

  requestSave(): void {
    const state: WorkerState = {
      simTimeMs:      this.state.simTimeMs,
      trueGlucose:    this.state.trueGlucose,
      lastCGM:        this.state.lastCGM,
      patient:        { ...this.state.patient },
      therapy:        { ...this.state.therapy },
      g6State:        this.state.g6.getState(),
      activeBoluses:  [...this.state.activeBoluses],
      activeMeals:    [...this.state.activeMeals],
      activeLongActing: [],
      pidIntegral:    this.state.pidIntegral,
      pidPrevCGM:     this.state.pidPrevCGM,
      throttle:       this.state.throttle,
      running:        this.state.running,
    };
    for (const h of this.savedHandlers) h(state);
  }

  reset(state: WorkerState): void {
    this.clearTimer();
    this.state.simTimeMs      = state.simTimeMs;
    this.state.trueGlucose    = state.trueGlucose;
    this.state.lastCGM        = state.lastCGM;
    this.state.patient        = { ...state.patient };
    this.state.therapy        = { ...state.therapy };
    this.state.activeBoluses  = [...state.activeBoluses];
    this.state.activeMeals    = [...state.activeMeals];
    this.state.resolvedMeals  = [];
    this.state.pumpMicroBoluses = [];
    this.state.pidIntegral    = state.pidIntegral;
    this.state.pidPrevCGM     = state.pidPrevCGM;
    this.state.throttle       = state.throttle;
    this.state.running        = false;
    this.state.g6             = createG6NoiseGenerator(DEFAULT_SEED, state.g6State);
    this.state.rngState       = DEFAULT_SEED;
  }

  terminate(): void { this.clearTimer(); }
}

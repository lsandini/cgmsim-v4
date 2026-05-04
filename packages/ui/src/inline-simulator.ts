/**
 * InlineSimulator — simulation engine running on the main thread.
 *
 * MDI long-acting injections fire from morning + evening slots when each slot's
 * configured time-of-day is reached (one fire per slot per simulated day). The
 * PK profile (peak, duration) is evaluated at injection time against the dose
 * and current patient.weight, then stamped onto the ActiveLongActing record so
 * the depot decays from those values regardless of any later weight change.
 */

import type {
  TickSnapshot,
  WorkerState,
  RapidAnalogueType,
  VirtualPatient,
  TherapyProfile,
  ActiveBolus,
  ActiveMeal,
  ActiveLongActing,
  LongActingSchedule,
  SimEvent,
  TempBasal,
} from '@cgmsim/shared';
import { DEFAULT_PATIENT, DEFAULT_THERAPY_PROFILE } from '@cgmsim/shared';

export type { SimEvent };

import { DexcomG6Noise, createG6NoiseGenerator } from '../../simulator/src/g6Noise.js';
import { computeDeltaBG } from '../../simulator/src/deltaBG.js';
import {
  calculateBolusIOB,
  calculatePumpBasalIOB,
} from '../../simulator/src/iob.js';
import type { PumpBasalBolus } from '../../simulator/src/iob.js';
import { calculateCOB, purgeAbsorbedMeals, resolveMealSplit } from '../../simulator/src/carbs.js';
import type { ResolvedMeal } from '../../simulator/src/carbs.js';
import { runPID, rateToMicroBolus } from '../../simulator/src/pid.js';
import type { PIDState } from '../../simulator/src/pid.js';
import { RAPID_PROFILES, LONG_ACTING_PROFILES } from '../../simulator/src/insulinProfiles.js';

const TICK_SIM_MINUTES = 5;
const TICK_SIM_MS      = TICK_SIM_MINUTES * 60_000;
function randomSeed(): number { return (Date.now() ^ (Math.random() * 0xFFFF_FFFF) >>> 0) || 1; }
const INITIAL_BG   = 100;


interface SimState {
  simTimeMs:         number;
  trueGlucose:       number;
  lastCGM:           number;
  patient:           VirtualPatient;
  therapy:           TherapyProfile;
  activeBoluses:     ActiveBolus[];
  activeLongActing:  ActiveLongActing[];
  resolvedMeals:     ResolvedMeal[];
  pumpMicroBoluses:  PumpBasalBolus[];
  pidCGMHistory:     number[];
  pidPrevRate:       number;
  pidTicksSinceLastMB: number;
  throttle:          number;
  running:           boolean;
  g6:                DexcomG6Noise;
  rngState:          number;
  lastMorningDay: number;
  lastEveningDay: number;
  tempBasal:         TempBasal | null;
  events:            SimEvent[];
}

function createInitialState(): SimState {
  return {
    simTimeMs:         0,
    trueGlucose:       INITIAL_BG,
    lastCGM:           INITIAL_BG,
    patient:           { ...DEFAULT_PATIENT },
    therapy:           { ...DEFAULT_THERAPY_PROFILE, basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }] },
    activeBoluses:     [],
    activeLongActing:  [],
    resolvedMeals:     [],
    pumpMicroBoluses:  [],
    pidCGMHistory:     [],
    pidPrevRate:       0.8,
    pidTicksSinceLastMB: 999,
    throttle:          10,
    running:           false,
    g6:                createG6NoiseGenerator(randomSeed(), null),
    rngState:          randomSeed(),
    lastMorningDay: -1,
    lastEveningDay: -1,
    tempBasal:         null,
    events:            [],
  };
}

function lcgNext(s: number): { value: number; nextState: number } {
  const n = (1664525 * s + 1013904223) & 0xffffffff;
  return { value: (n >>> 0) / 0xffffffff, nextState: n };
}

type TickHandler  = (snap: TickSnapshot) => void;
type EventHandler = (events: SimEvent[]) => void;

export class InlineSimulator {
  private s: SimState = createInitialState();
  private rafId: number | null = null;
  private lastTickWallMs = 0;
  private tickHandlers:  TickHandler[]  = [];
  private eventHandlers: EventHandler[] = [];

  onTick(h: TickHandler):    void { this.tickHandlers.push(h); }
  onEvent(h: EventHandler):  void { this.eventHandlers.push(h); }

  private getBasalRate(simTimeMs: number): number {
    const s = this.s;
    if (s.tempBasal !== null) {
      if (simTimeMs < s.tempBasal.expiresAt) return s.tempBasal.rateUPerHour;
      s.tempBasal = null;
    }
    const minuteOfDay = (simTimeMs / 60_000) % (24 * 60);
    const profile = s.therapy.basalProfile;
    let rate = profile[0]?.rateUPerHour ?? 0.8;
    for (const e of profile) if (e.timeMinutes <= minuteOfDay) rate = e.rateUPerHour;
    return rate;
  }

  private checkLongActingDose(): void {
    const s = this.s;
    if (s.therapy.mode !== 'MDI') return;
    const minuteOfDay = (s.simTimeMs / 60_000) % (24 * 60);
    const simDay      = Math.floor(s.simTimeMs / (24 * 60 * 60_000));

    this.fireSlotIfDue('morning', s.therapy.longActingMorning, minuteOfDay, simDay);
    this.fireSlotIfDue('evening', s.therapy.longActingEvening, minuteOfDay, simDay);
  }

  private fireSlotIfDue(
    slot: 'morning' | 'evening',
    schedule: LongActingSchedule | null,
    minuteOfDay: number,
    simDay: number,
  ): void {
    if (schedule === null) return;
    const s = this.s;
    const lastDayKey = slot === 'morning' ? 'lastMorningDay' : 'lastEveningDay';
    if (minuteOfDay < schedule.injectionMinute) return;
    if (simDay === s[lastDayKey]) return;

    s[lastDayKey] = simDay;

    // Stamp PK params at injection time from current patient.weight
    const pk = LONG_ACTING_PROFILES[schedule.type];
    const duration = pk.duration(schedule.units, s.patient.weight);
    const peak = pk.peak(duration);

    s.activeLongActing.push({
      id: `la-${slot}-${s.simTimeMs}`,
      simTimeMs: s.simTimeMs,
      units: schedule.units,
      type: schedule.type,
      peak,
      duration,
    });

    const ev: SimEvent = {
      kind: 'longActing',
      simTimeMs: s.simTimeMs,
      units: schedule.units,
      insulinType: schedule.type,
      slot,
    };
    s.events.push(ev);
    for (const h of this.eventHandlers) h([ev]);
  }

  private tick(): void {
    const s = this.s;
    const nowMs  = s.simTimeMs;
    const isPump = s.therapy.mode === 'PUMP' || s.therapy.mode === 'AID';

    this.checkLongActingDose();

    // Purge expired
    s.activeBoluses = s.activeBoluses.filter(b => (nowMs - b.simTimeMs) / 60_000 <= b.dia * 60);
    s.activeLongActing = s.activeLongActing.filter(d =>
      (nowMs - d.simTimeMs) / 60_000 <= d.duration,
    );
    s.resolvedMeals    = purgeAbsorbedMeals(s.resolvedMeals, s.patient.carbsAbsTime, nowMs);
    s.pumpMicroBoluses = s.pumpMicroBoluses.filter(mb => (nowMs - mb.simTimeMs) / 60_000 <= mb.dia * 60);

    let basalRate = this.getBasalRate(nowMs);

    if (s.therapy.mode === 'AID') {
      const totalIOB = calculateBolusIOB(s.activeBoluses, nowMs)
        + calculatePumpBasalIOB(s.pumpMicroBoluses, nowMs);
      const rp = RAPID_PROFILES[s.therapy.rapidAnalogue];
      const pidState: PIDState = {
        cgmHistory: s.pidCGMHistory,
        prevRate: s.pidPrevRate,
        ticksSinceLastMB: s.pidTicksSinceLastMB,
      };
      const pid = runPID(s.lastCGM, totalIOB, s.therapy, pidState, basalRate, rp?.peak ?? 55);
      basalRate              = pid.rateUPerHour;
      s.pidCGMHistory        = pid.nextState.cgmHistory;
      s.pidPrevRate          = pid.nextState.prevRate;
      s.pidTicksSinceLastMB  = pid.nextState.ticksSinceLastMB;
      if (pid.microbolusUnits > 0) {
        s.activeBoluses.push({
          id: `mb-${nowMs}`, simTimeMs: nowMs,
          units: pid.microbolusUnits, analogue: s.therapy.rapidAnalogue,
          dia: s.patient.dia,
        });
        const smbEv: SimEvent = { kind: 'smb', simTimeMs: nowMs, units: pid.microbolusUnits };
        s.events.push(smbEv);
        for (const h of this.eventHandlers) h([smbEv]);
      }
    }

    if (isPump) {
      const rp = RAPID_PROFILES[s.therapy.rapidAnalogue];
      if (rp) {
        const u = rateToMicroBolus(basalRate);
        if (u > 0) s.pumpMicroBoluses.push({ simTimeMs: nowMs, units: u, dia: s.patient.dia, peak: rp.peak });
      }
    }

    const delta = computeDeltaBG({
      patient: s.patient, isf: s.patient.trueISF, cr: s.patient.trueCR,
      boluses: s.activeBoluses, longActing: s.activeLongActing,
      pumpMicroBoluses: s.pumpMicroBoluses, meals: s.resolvedMeals,
      nowSimTimeMs: nowMs, isPump,
      currentGlucose: s.trueGlucose,
    });

    const newTrue = Math.max(20, Math.min(600, s.trueGlucose + delta.deltaBG));
    const noisy   = s.g6.applySensorModel(newTrue, nowMs);
    const cgm     = Math.max(40, Math.min(400, Math.round(noisy)));

    const iob = calculateBolusIOB(s.activeBoluses, nowMs)
      + (isPump ? calculatePumpBasalIOB(s.pumpMicroBoluses, nowMs) : 0);
    const cob = calculateCOB(s.resolvedMeals, s.patient.carbsAbsTime, nowMs);

    s.trueGlucose = newTrue;
    s.lastCGM     = cgm;
    s.simTimeMs   = nowMs + TICK_SIM_MS;

    const snap: TickSnapshot = {
      type: 'TICK', simTimeMs: s.simTimeMs, cgm, trueGlucose: newTrue,
      iob: Math.round(iob * 100) / 100, cob: Math.round(cob * 10) / 10,
      deltaMinutes: 5, trend: delta.deltaBG / TICK_SIM_MINUTES, basalRate,
    };
    for (const h of this.tickHandlers) h(snap);
  }

  private rafLoop(wallNow: number): void {
    if (!this.s.running) return;
    const intervalMs = TICK_SIM_MS / this.s.throttle;
    const ticksDue = Math.floor((wallNow - this.lastTickWallMs) / intervalMs);
    const ticksToRun = Math.min(ticksDue, 50); // cap catch-up after tab was hidden
    for (let i = 0; i < ticksToRun; i++) this.tick();
    if (ticksToRun > 0) this.lastTickWallMs += ticksToRun * intervalMs;
    this.rafId = requestAnimationFrame((t) => this.rafLoop(t));
  }

  resume(): void {
    this.s.running = true;
    this.tick();
    this.lastTickWallMs = performance.now();
    this.rafId = requestAnimationFrame((t) => this.rafLoop(t));
  }

  pause(): void {
    this.s.running = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  setThrottle(throttle: number): void {
    this.s.throttle = throttle;
    // Reset reference point to avoid a burst of catch-up ticks at the new rate
    if (this.s.running) this.lastTickWallMs = performance.now();
  }

  /**
   * @param units    bolus amount in U
   * @param analogue rapid insulin profile (defaults to therapy's rapid analogue)
   * @param simTimeMs OPTIONAL stamp time. Defaults to engine.simTimeMs (latest
   *   tick's post-advance time). The renderer passes its `displayedSimTime`
   *   here so markers appear at the user's "now" line instantly instead of
   *   landing in the lookahead zone where they'd be culled. The bolus is
   *   processed normally by subsequent ticks; only the simTime stamp differs
   *   (by at most one tick interval).
   */
  bolus(units: number, analogue?: RapidAnalogueType, simTimeMs?: number): void {
    const t = simTimeMs ?? this.s.simTimeMs;
    this.s.activeBoluses.push({
      id: `bolus-${t}-${Math.random().toString(36).slice(2)}`,
      simTimeMs: t, units,
      analogue: analogue ?? this.s.therapy.rapidAnalogue,
      dia: this.s.patient.dia,
    });
    const ev: SimEvent = { kind: 'bolus', simTimeMs: t, units };
    this.s.events.push(ev);
    for (const h of this.eventHandlers) h([ev]);
  }

  /** Same `simTimeMs` override pattern as `bolus()` — stamp at displayedSimTime
   *  for instant marker visibility. */
  meal(carbsG: number, gastricEmptyingRate?: number, simTimeMs?: number): void {
    const t = simTimeMs ?? this.s.simTimeMs;
    const meal: ActiveMeal = {
      id: `meal-${t}-${Math.random().toString(36).slice(2)}`,
      simTimeMs: t, carbsG,
      gastricEmptyingRate: gastricEmptyingRate ?? this.s.patient.gastricEmptyingRate,
    };
    const { value, nextState } = lcgNext(this.s.rngState);
    this.s.rngState = nextState;
    this.s.resolvedMeals.push(resolveMealSplit(meal, value));
    const ev: SimEvent = { kind: 'meal', simTimeMs: t, carbsG };
    this.s.events.push(ev);
    for (const h of this.eventHandlers) h([ev]);
  }

  setTempBasal(rateUPerHour: number, durationMinutes?: number): void {
    this.s.tempBasal = {
      rateUPerHour,
      expiresAt: durationMinutes !== undefined
        ? this.s.simTimeMs + durationMinutes * 60_000
        : Infinity,
    };
  }

  cancelTempBasal(): void { this.s.tempBasal = null; }

  setTarget(targetMgdL: number): void { this.s.therapy.glucoseTarget = targetMgdL; }
  setPatientParam(patch: Partial<VirtualPatient>): void { Object.assign(this.s.patient, patch); }
  setTherapyParam(patch: Partial<TherapyProfile>): void { Object.assign(this.s.therapy, patch); }

  /** Build a complete, deeply-cloned snapshot of the current simulator state. */
  getCurrentState(): WorkerState {
    return {
      simTimeMs: this.s.simTimeMs, trueGlucose: this.s.trueGlucose, lastCGM: this.s.lastCGM,
      patient: { ...this.s.patient }, therapy: { ...this.s.therapy },
      g6State: this.s.g6.getState(),
      activeBoluses: [...this.s.activeBoluses],
      activeLongActing: [...this.s.activeLongActing],
      resolvedMeals: this.s.resolvedMeals.map((m) => ({ ...m })),
      pumpMicroBoluses: this.s.pumpMicroBoluses.map((b) => ({ ...b })),
      tempBasal: this.s.tempBasal ? { ...this.s.tempBasal } : null,
      events: this.s.events.map((e) => ({ ...e })),
      rngState: this.s.rngState,
      lastMorningDay: this.s.lastMorningDay,
      lastEveningDay: this.s.lastEveningDay,
      pidCGMHistory: [...this.s.pidCGMHistory],
      pidPrevRate: this.s.pidPrevRate,
      pidTicksSinceLastMB: this.s.pidTicksSinceLastMB,
      throttle: this.s.throttle, running: this.s.running,
    };
  }

  reset(state: WorkerState): void {
    this.pause();
    Object.assign(this.s, {
      simTimeMs: state.simTimeMs, trueGlucose: state.trueGlucose, lastCGM: state.lastCGM,
      patient: { ...state.patient }, therapy: { ...state.therapy },
      activeBoluses: [...(state.activeBoluses ?? [])],
      activeLongActing: [...(state.activeLongActing ?? [])],
      resolvedMeals: (state.resolvedMeals ?? []).map((m) => ({ ...m })),
      pumpMicroBoluses: (state.pumpMicroBoluses ?? []).map((b) => ({ ...b })),
      pidCGMHistory: [...(state.pidCGMHistory ?? [])],
      pidPrevRate: state.pidPrevRate ?? 0.8,
      pidTicksSinceLastMB: state.pidTicksSinceLastMB ?? 999,
      throttle: state.throttle, running: false,
      g6: createG6NoiseGenerator(1, state.g6State),
      rngState: state.rngState ?? randomSeed(),
      lastMorningDay: state.lastMorningDay ?? -1,
      lastEveningDay: state.lastEveningDay ?? -1,
      tempBasal: state.tempBasal ? { ...state.tempBasal } : null,
      events: (state.events ?? []).map((e) => ({ ...e })),
    });
  }

  terminate(): void { this.pause(); }
}

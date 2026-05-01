// ============================================================
// CGMSIM v4 — Shared Type Definitions
// All types shared between packages/simulator and packages/ui
// No runtime code; types only.
// ============================================================

// ------------------------------------------------------------
// Primitives
// ------------------------------------------------------------

/** All glucose values are mg/dL internally. */
export type MgdL = number;

/** Simulation time in milliseconds since epoch (simulated, not wall-clock). */
export type SimTimeMs = number;

export type TherapyMode = 'MDI' | 'PUMP' | 'AID';

export type RapidAnalogueType = 'Fiasp' | 'Lispro' | 'Aspart';

export type LongActingType =
  | 'GlargineU100'   // Lantus (U100)
  | 'GlargineU300'   // Toujeo (U300)
  | 'Detemir'        // Levemir
  | 'Degludec';      // Tresiba

export type DisplayUnit = 'mgdl' | 'mmoll';

// ------------------------------------------------------------
// Virtual Patient — Physiological Layer (ground truth)
// ------------------------------------------------------------

export interface VirtualPatient {
  /** Body weight in kg. */
  weight: number;
  /** Diabetes duration in years (affects counter-regulation). */
  diabetesDuration: number;

  /** True ISF: how much 1 unit of rapid insulin lowers BG (mg/dL/U). */
  trueISF: MgdL;
  /** True insulin-to-carbohydrate ratio (g/U). */
  trueCR: number;

  /** True duration of insulin action in hours — drives physical bolus/microbolus decay. */
  dia: number;
  /** Carbohydrate absorption time in minutes (default 360). */
  carbsAbsTime: number;

  /** Gastric emptying rate multiplier (0.5 = slow/fatty, 2.0 = fast/sugary). */
  gastricEmptyingRate: number;
}

export const DEFAULT_PATIENT: VirtualPatient = {
  weight: 75,
  diabetesDuration: 10,
  trueISF: 40,
  trueCR: 12,
  dia: 6,
  carbsAbsTime: 360,
  gastricEmptyingRate: 1.0,
};

// ------------------------------------------------------------
// Therapy Profile Layer (what the device is programmed to do)
// ------------------------------------------------------------

/** Single entry in a 24-hour basal schedule. timeMinutes is 0–1439. */
export interface BasalEntry {
  /** Minutes since midnight (0–1439). */
  timeMinutes: number;
  /** Rate in U/hr. */
  rateUPerHour: number;
}

export interface LongActingSchedule {
  type: LongActingType;
  /** Dose in units. */
  units: number;
  /** Minute of day (0..1439). Morning slot: 0..719. Evening slot: 720..1439. */
  injectionMinute: number;
}

export interface TherapyProfile {
  mode: TherapyMode;

  /** 24-hour basal schedule (pump/AID). Sorted ascending by timeMinutes. */
  basalProfile: BasalEntry[];

  rapidAnalogue: RapidAnalogueType;
  /** DIA in hours used by the controller / PID for IOB math (programmed belief, may differ from patient.dia). */
  rapidDia: number;

  /** MDI long-acting morning slot (00:00–11:59). null = unset. */
  longActingMorning: LongActingSchedule | null;
  /** MDI long-acting evening slot (12:00–23:59). null = unset. */
  longActingEvening: LongActingSchedule | null;

  /** AID PID glucose target (mg/dL). */
  glucoseTarget: MgdL;
  /** AID: enable supermicrobolus rules (rapid rise, sustained rise, prolonged high). */
  enableSMB: boolean;
}

export const DEFAULT_THERAPY_PROFILE: TherapyProfile = {
  mode: 'PUMP',
  basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }],
  rapidAnalogue: 'Fiasp',
  rapidDia: 5,
  longActingMorning: null,
  longActingEvening: null,
  glucoseTarget: 100,
  enableSMB: false,
};

// ------------------------------------------------------------
// G6 Noise State (must be serialisable for save/restore)
// ------------------------------------------------------------

export interface G6NoiseState {
  /** Sensor-specific AR(2) state: [t-2, t-1]. */
  v: [number, number];
  /** Common component AR(2) state: [t-2, t-1]. */
  cc: [number, number];
  /** Calibration timestamp in ms (for deterministic drift polynomials). */
  tCalib: number;
  /** Ziggurat RNG state. */
  rng: { jsr: number; seed: number };
}

// ------------------------------------------------------------
// Active Treatment Records (held in simulator state)
// ------------------------------------------------------------

export interface ActiveBolus {
  id: string;
  /** Simulated timestamp of injection (ms). */
  simTimeMs: SimTimeMs;
  units: number;
  analogue: RapidAnalogueType;
  /** DIA in hours stamped at injection time from patient.dia (true physiological DIA). */
  dia: number;
}

export interface ActiveMeal {
  id: string;
  simTimeMs: SimTimeMs;
  carbsG: number;
  /** Gastric emptying multiplier for this specific meal. */
  gastricEmptyingRate: number;
}

export interface ActiveLongActing {
  id: string;
  simTimeMs: SimTimeMs;
  units: number;
  type: LongActingType;
  /** Stamped at injection time from v3 PK formulas + patient.weight. Minutes. */
  peak: number;
  /** Stamped at injection time. Total duration of action in minutes. */
  duration: number;
}

// ------------------------------------------------------------
// WebWorker State (complete, serialisable)
// ------------------------------------------------------------

export interface WorkerState {
  /** Current simulated time in ms since start of simulation epoch. */
  simTimeMs: SimTimeMs;

  /** Current true blood glucose (mg/dL), before noise. */
  trueGlucose: MgdL;

  /** Last CGM reading posted to the UI (noisy, rounded). */
  lastCGM: MgdL;

  patient: VirtualPatient;
  therapy: TherapyProfile;

  g6State: G6NoiseState;

  activeBoluses: ActiveBolus[];
  activeMeals: ActiveMeal[];
  activeLongActing: ActiveLongActing[];

  /** PID controller: last ≤24 CGM readings for integral term (oldest first). */
  pidCGMHistory: number[];
  /** PID controller: last delivered basal rate for rate-of-change limiting. */
  pidPrevRate: number;
  /** PID controller: ticks since last microbolus for interval safety. */
  pidTicksSinceLastMB: number;

  /** Throttle factor (1 = real time, 100 = max). */
  throttle: number;

  /** Whether the worker is currently running. */
  running: boolean;
}

// ------------------------------------------------------------
// WebWorker Inbound Messages (main thread → worker)
// ------------------------------------------------------------

export interface MsgBolus {
  type: 'BOLUS';
  units: number;
  analogue?: RapidAnalogueType;
}

export interface MsgMeal {
  type: 'MEAL';
  carbsG: number;
  gastricEmptyingRate?: number;
}

export interface MsgSetBasal {
  type: 'SET_BASAL';
  rateUPerHour: number;
  /** Duration in simulated minutes; omit to persist indefinitely. */
  durationMinutes?: number;
}

export interface MsgSetTarget {
  type: 'SET_TARGET';
  targetMgdL: MgdL;
}

export interface MsgSetPatientParam {
  type: 'SET_PATIENT_PARAM';
  patch: Partial<VirtualPatient>;
}

export interface MsgSetTherapyParam {
  type: 'SET_THERAPY_PARAM';
  patch: Partial<TherapyProfile>;
}

export interface MsgSetThrottle {
  type: 'SET_THROTTLE';
  throttle: number;
}

export interface MsgPause {
  type: 'PAUSE';
}

export interface MsgResume {
  type: 'RESUME';
}

export interface MsgSaveState {
  type: 'SAVE_STATE';
}

export interface MsgReset {
  type: 'RESET';
  state: WorkerState;
}

export type WorkerInboundMessage =
  | MsgBolus
  | MsgMeal
  | MsgSetBasal
  | MsgSetTarget
  | MsgSetPatientParam
  | MsgSetTherapyParam
  | MsgSetThrottle
  | MsgPause
  | MsgResume
  | MsgSaveState
  | MsgReset;

// ------------------------------------------------------------
// WebWorker Outbound Messages (worker → main thread)
// ------------------------------------------------------------

/** Posted every tick. Deliberately minimal — only what the UI needs. */
export interface TickSnapshot {
  type: 'TICK';
  simTimeMs: SimTimeMs;
  cgm: MgdL;
  /** True glucose (not displayed, useful for debug overlay). */
  trueGlucose: MgdL;
  iob: number;
  cob: number;
  deltaMinutes: 5;
  /** Direction arrow: positive = rising. */
  trend: MgdL;
  /** AID basal delivery this tick (U/hr equivalent). */
  basalRate: number;
}

export interface StateSavedMessage {
  type: 'STATE_SAVED';
  state: WorkerState;
}

export type WorkerOutboundMessage = TickSnapshot | StateSavedMessage;

// ------------------------------------------------------------
// Session History Record
// ------------------------------------------------------------

export interface SessionHistoryRecord {
  simTimeMs: SimTimeMs;
  cgm: MgdL;
  iob: number;
  cob: number;
}

// ------------------------------------------------------------
// Scenario (named parameter preset)
// ------------------------------------------------------------

export interface Scenario {
  name: string;
  description: string;
  patient: VirtualPatient;
  therapy: TherapyProfile;
  /** Seed for G6 noise for reproducible comparison runs. */
  noiseSeed: number;
}

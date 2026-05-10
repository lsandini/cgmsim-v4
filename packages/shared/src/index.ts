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

/** MDI submode: LIVE (free-form events) or PRESCRIPTION (auto-fired schedule). */
export type MDISubmode = 'LIVE' | 'PRESCRIPTION';

/**
 * Hospital-tray meal slot in PRESCRIPTION submode. Times and grams are fixed
 * defaults; only `bolusUnits` is user-editable.
 */
export interface PrescribedMealSlot {
  /** Hour of day (0–23). */
  hour: number;
  /** Minute of hour (0–59). */
  minute: number;
  /** Grams of carbs (fixed by hospital protocol — read-only in the editor). */
  grams: number;
  /** Mealtime bolus, fired 10 min before this slot. 0 = no bolus. */
  bolusUnits: number;
}

/**
 * Hyperglycaemia sliding-scale correction. Thresholds are globally predefined
 * at 8 / 12 / 16 mmol/L; only the unit doses are user-editable. "Highest tier
 * wins": at CGM = 13 mmol/L give units2 (not units1+units2).
 */
export interface CorrectionScale {
  units1: number;  // applied if CGM > 8  mmol/L
  units2: number;  // applied if CGM > 12 mmol/L
  units3: number;  // applied if CGM > 16 mmol/L
}

export interface Prescription {
  fasting: boolean;
  meals: PrescribedMealSlot[];
  correction: CorrectionScale;
  /** Hours of day at which corrections fire when `fasting === true`. */
  fastingCorrectionHours: number[];
}

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

  /** MDI submode (only meaningful when mode === 'MDI'). */
  mdiSubmode: MDISubmode;
  /** Pre-programmed regimen used when mdiSubmode === 'PRESCRIPTION'. */
  prescription: Prescription;
}

export const DEFAULT_PRESCRIPTION: Prescription = {
  fasting: false,
  meals: [
    { hour: 7,  minute: 0, grams: 40, bolusUnits: 0 },
    { hour: 11, minute: 0, grams: 80, bolusUnits: 0 },
    { hour: 13, minute: 0, grams: 30, bolusUnits: 0 },
    { hour: 17, minute: 0, grams: 70, bolusUnits: 0 },
    { hour: 20, minute: 0, grams: 30, bolusUnits: 0 },
  ],
  correction: { units1: 0, units2: 0, units3: 0 },
  fastingCorrectionHours: [7, 13, 17, 22],
};

export const DEFAULT_THERAPY_PROFILE: TherapyProfile = {
  mode: 'MDI',
  basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }],
  rapidAnalogue: 'Fiasp',
  rapidDia: 5,
  longActingMorning: null,
  longActingEvening: null,
  glucoseTarget: 100,
  enableSMB: false,
  mdiSubmode: 'LIVE',
  prescription: DEFAULT_PRESCRIPTION,
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

/** Meal record after the fast/slow split has been resolved (decided once at meal entry). */
export interface ResolvedMeal {
  id: string;
  simTimeMs: SimTimeMs;
  carbsG: number;
  gastricEmptyingRate: number;
  /** Fast-absorbing carb fraction (g) — determined at meal entry, immutable. */
  fastCarbsG: number;
  /** Slow-absorbing carb fraction (g) — determined at meal entry, immutable. */
  slowCarbsG: number;
}

/** Pump microbolus injected by the AID controller; PK params stamped at injection. */
export interface PumpBasalBolus {
  simTimeMs: SimTimeMs;
  units: number;
  /** DIA in hours (from therapy rapid analogue profile). */
  dia: number;
  /** Peak in minutes (from therapy rapid analogue profile). */
  peak: number;
}

/** Discrete events emitted by the simulator for chart-marker rendering. */
export type SimEvent =
  | { kind: 'bolus';      simTimeMs: SimTimeMs; units: number }
  | { kind: 'meal';       simTimeMs: SimTimeMs; carbsG: number }
  | { kind: 'longActing'; simTimeMs: SimTimeMs; units: number; insulinType: LongActingType; slot?: 'morning' | 'evening' | 'manual' }
  | { kind: 'smb';        simTimeMs: SimTimeMs; units: number };

/** Active temporary basal override (set via setTempBasal). */
export interface TempBasal {
  rateUPerHour: number;
  /** Absolute simTimeMs at which the override expires. */
  expiresAt: SimTimeMs;
}

/** A single point of the rendered CGM trace history (the renderer's ring-buffer entry). */
export interface CGMTracePoint {
  simTimeMs: SimTimeMs;
  cgm: MgdL;
  trueGlucose: MgdL;
  iob: number;
  cob: number;
  trend: MgdL;
  basalRate: number;
  /** MDI long-acting insulin activity (U/hr-equivalent). 0 in PUMP/AID mode. */
  longActingActivity: number;
}

// ------------------------------------------------------------
// Simulation state — complete, serialisable snapshot used for
// save/restore and comparison-run snapshots.
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
  activeLongActing: ActiveLongActing[];

  /** Meals after fast/slow split has been resolved — drives carb effect & COB. */
  resolvedMeals: ResolvedMeal[];

  /** AID-mode microboluses still resolving in the body. */
  pumpMicroBoluses: PumpBasalBolus[];

  /** Active temporary basal override, or null if none. */
  tempBasal: TempBasal | null;

  /** Discrete event log (boluses, meals, long-acting, SMB) for chart markers. */
  events: SimEvent[];

  /** Seeded LCG state for the meal-split RNG. Persisting it preserves reproducibility. */
  rngState: number;

  /** Rendered CGM trace — written at export time, read at import time. Optional for v1 compatibility. */
  cgmHistory?: CGMTracePoint[];

  /** Last sim-day on which the morning long-acting slot fired (-1 = never).
   *  Persisted so save/restore mid-day doesn't re-fire today's morning dose. */
  lastMorningDay: number;
  /** Same for the evening slot. */
  lastEveningDay: number;

  /**
   * Per-slot last-fired sim-day for PRESCRIPTION submode. Keys are stable slot
   * identifiers like `meal-7-bolus`, `meal-7-carbs`, `corr-fast-13`. Persisted
   * so save/restore and submode toggles don't re-fire already-delivered slots.
   */
  prescriptionLastFiredDay: Record<string, number>;

  /** PID controller: last ≤24 CGM readings for integral term (oldest first). */
  pidCGMHistory: number[];
  /** PID controller: last delivered basal rate for rate-of-change limiting. */
  pidPrevRate: number;
  /** PID controller: ticks since last microbolus for interval safety. */
  pidTicksSinceLastMB: number;

  /** Throttle factor (1 = real time, 100 = max). */
  throttle: number;

  /** Whether the simulator is currently running. */
  running: boolean;
}

// ------------------------------------------------------------
// Tick snapshot — emitted by the simulator each tick to UI handlers.
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
  /** MDI long-acting insulin activity (U/hr-equivalent). 0 in PUMP/AID mode. */
  longActingActivity: number;
}

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

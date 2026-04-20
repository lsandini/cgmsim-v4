/** All glucose values are mg/dL internally. */
export type MgdL = number;
/** Simulation time in milliseconds since epoch (simulated, not wall-clock). */
export type SimTimeMs = number;
export type GenderType = 'Male' | 'Female';
export type TherapyMode = 'MDI' | 'PUMP' | 'AID';
export type RapidAnalogueType = 'Fiasp' | 'Lispro' | 'Aspart';
export type LongActingType = 'Glargine' | 'Degludec' | 'Detemir';
export type DisplayUnit = 'mgdl' | 'mmoll';
export interface VirtualPatient {
    /** Body weight in kg. */
    weight: number;
    /** Age in years. */
    age: number;
    gender: GenderType;
    /** Diabetes duration in years (affects counter-regulation, Phase 4). */
    diabetesDuration: number;
    /** True ISF: how much 1 unit of rapid insulin lowers BG (mg/dL/U). */
    trueISF: MgdL;
    /** True insulin-to-carbohydrate ratio (g/U). */
    trueCR: number;
    /** Duration of insulin action in hours (default 6). */
    dia: number;
    /** Time to peak activity in minutes (default 75). */
    tp: number;
    /** Carbohydrate absorption time in minutes (default 360). */
    carbsAbsTime: number;
    /** EGP: average hepatic glucose contribution (mg/dL/min). */
    egpBasalLevel: number;
    /** EGP: dawn phenomenon amplitude multiplier (0–2, default 1). */
    egpAmplitude: number;
    /** EGP: hour of peak hepatic output (0–23, default 5). */
    egpPeakHour: number;
    /** Gastric emptying rate multiplier (0.5 = slow/fatty, 2.0 = fast/sugary). */
    gastricEmptyingRate: number;
}
export declare const DEFAULT_PATIENT: VirtualPatient;
/** Single entry in a 24-hour basal schedule. timeMinutes is 0–1439. */
export interface BasalEntry {
    /** Minutes since midnight (0–1439). */
    timeMinutes: number;
    /** Rate in U/hr. */
    rateUPerHour: number;
}
export interface TherapyProfile {
    mode: TherapyMode;
    /** Programmed ISF (may differ from trueISF to create teaching scenarios). */
    programmedISF: MgdL;
    /** Programmed ICR (may differ from trueCR). */
    programmedCR: number;
    /** 24-hour basal schedule (pump/AID). Sorted ascending by timeMinutes. */
    basalProfile: BasalEntry[];
    rapidAnalogue: RapidAnalogueType;
    /** MDI long-acting insulin type. */
    longActingType: LongActingType;
    /** MDI long-acting dose in units. */
    longActingDose: number;
    /** MDI injection time as minutes since midnight. */
    longActingInjectionTime: number;
    /** AID/bolus advisor glucose target (mg/dL). */
    glucoseTarget: MgdL;
    /** Bolus advisor correction threshold (mg/dL). */
    correctionThreshold: MgdL;
}
export declare const DEFAULT_THERAPY_PROFILE: TherapyProfile;
export interface G6NoiseState {
    /** Sensor-specific AR(2) state: [t-2, t-1]. */
    v: [number, number];
    /** Common component AR(2) state: [t-2, t-1]. */
    cc: [number, number];
    /** Calibration timestamp in ms (for deterministic drift polynomials). */
    tCalib: number;
    /** Ziggurat RNG state. */
    rng: {
        jsr: number;
        seed: number;
    };
}
export interface ActiveBolus {
    id: string;
    /** Simulated timestamp of injection (ms). */
    simTimeMs: SimTimeMs;
    units: number;
    analogue: RapidAnalogueType;
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
}
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
    /** PID controller integral accumulator (mg/dL·min). */
    pidIntegral: number;
    /** Previous CGM reading for derivative term. */
    pidPrevCGM: MgdL;
    /** Throttle factor (1 = real time, 100 = max). */
    throttle: number;
    /** Whether the worker is currently running. */
    running: boolean;
}
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
export type WorkerInboundMessage = MsgBolus | MsgMeal | MsgSetBasal | MsgSetTarget | MsgSetPatientParam | MsgSetTherapyParam | MsgSetThrottle | MsgPause | MsgResume | MsgSaveState | MsgReset;
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
export interface SessionHistoryRecord {
    simTimeMs: SimTimeMs;
    cgm: MgdL;
    iob: number;
    cob: number;
}
export interface Scenario {
    name: string;
    description: string;
    patient: VirtualPatient;
    therapy: TherapyProfile;
    /** Seed for G6 noise for reproducible comparison runs. */
    noiseSeed: number;
}
//# sourceMappingURL=index.d.ts.map
/**
 * Core mathematical utilities for the CGMSIM v4 simulation engine.
 * Ported from @lsandini/cgmsim-lib utils.ts; Nightscout dependencies removed.
 *
 * The biexponential model represents subcutaneous insulin absorption and
 * elimination as two competing exponential processes, producing the
 * characteristic bell-shaped activity curve observed in pharmacokinetic studies.
 */
export interface ExpTreatmentParams {
    /** Time to peak activity in minutes. */
    peak: number;
    /** Total duration of action in minutes. */
    duration: number;
    /** Minutes elapsed since dose was given. */
    minutesAgo: number;
    /** Dose size in units. */
    units: number;
}
/**
 * Compute instantaneous insulin activity (U/min) for a single dose.
 *
 * Uses the biexponential parametric model from cgmsim-lib.
 * The curve is normalised so its integral over [0, duration] equals `units`.
 * Returns zero outside the active window [0, duration].
 */
export declare function getExpTreatmentActivity(p: ExpTreatmentParams): number;
/**
 * Compute insulin on board (units remaining) for a single dose.
 * Uses smooth cubic IOB decay that matches the activity integral.
 */
export declare function getExpTreatmentIOB(p: ExpTreatmentParams): number;
export declare function roundTo8Decimals(n: number): number;
/**
 * Minutes elapsed since a given simulated timestamp.
 * Both arguments are ms-since-epoch in simulated time.
 */
export declare function getDeltaMinutes(eventSimTimeMs: number, nowSimTimeMs: number): number;
//# sourceMappingURL=utils.d.ts.map
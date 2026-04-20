/**
 * Endogenous Glucose Production (EGP) model.
 *
 * Sinusoidal function with a 24-hour period representing circadian hepatic
 * glucose output. The dawn phenomenon (early-morning EGP rise driven by
 * cortisol/GH) is the primary educational target of this model.
 *
 * Future Phase 4: glucose-dependent EGP (counter-regulatory activation on
 * hypoglycaemia, suppression on hyperglycaemia).
 *
 * Returns mg/dL contribution per tick (5-minute interval).
 */
import type { VirtualPatient } from '@cgmsim/shared';
/**
 * Compute EGP contribution for the current tick.
 *
 * The sinusoidal EGP is:
 *   EGP(t) = basalLevel * (1 + amplitude * cos(2π(t_hours - peakHour)/24))
 *
 * cos() is used so the function peaks exactly at egpPeakHour (phase = 0 → cos = 1).
 *
 * @param patient         Virtual patient (uses egp* params)
 * @param simTimeMs       Current simulated time in ms since simulation start
 * @param isf             True ISF (mg/dL/U) — scales hepatic output
 */
export declare function calculateEGP(patient: VirtualPatient, simTimeMs: number, isf: number): number;
//# sourceMappingURL=egp.d.ts.map
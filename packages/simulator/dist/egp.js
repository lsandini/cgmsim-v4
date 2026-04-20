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
const TWO_PI = 2 * Math.PI;
const MINUTES_PER_DAY = 24 * 60;
const TICK_MINUTES = 5;
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
export function calculateEGP(patient, simTimeMs, isf) {
    // Time within the current day in minutes (0–1439)
    const minuteOfDay = (simTimeMs / 60_000) % MINUTES_PER_DAY;
    const hourOfDay = minuteOfDay / 60;
    // Cosine so the function peaks exactly at egpPeakHour (not 6h later)
    const phase = TWO_PI * (hourOfDay - patient.egpPeakHour) / 24;
    const sinFactor = 1 + patient.egpAmplitude * Math.cos(phase);
    // Base hepatic glucose production per 5-minute tick (mg/dL)
    // egpBasalLevel is calibrated so that at ISF=40 a fasting patient
    // rises ~2 mmol/L (36 mg/dL) from midnight to dawn peak without insulin.
    const egpPerMin = patient.egpBasalLevel * sinFactor * (isf / 40);
    return egpPerMin * TICK_MINUTES;
}
//# sourceMappingURL=egp.js.map
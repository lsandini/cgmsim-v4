/**
 * Endogenous Glucose Production (EGP) model.
 *
 * Sinusoidal function with a 24-hour period modelling circadian hepatic
 * glucose output and the dawn phenomenon.
 *
 * Phase 3 addition: counter-regulatory response.
 * When glucose falls below the hypoglycaemia threshold, intact counter-
 * regulation boosts EGP. The response strength is scaled by diabetes
 * duration — a patient with 30+ years T1D has fully blunted counter-
 * regulation, making hypoglycaemic episodes more severe and prolonged.
 */
const TWO_PI = 2 * Math.PI;
const MINUTES_PER_DAY = 24 * 60;
const TICK_MINUTES = 1;
// Counter-regulation thresholds (mg/dL)
const CR_ONSET_BG = 80; // response begins here
const CR_FULL_BG = 54; // full response at this level
const CR_MAX_BOOST = 0.8; // max 80% additional EGP at full activation
const CR_ZERO_YEARS = 30; // diabetes duration at which response = 0
/**
 * Compute EGP contribution for the current tick (mg/dL).
 *
 * Formula: basalLevel * (1 + amplitude * cos(2π(hour - peakHour)/24))
 * cos() peaks at phase=0, i.e. exactly at egpPeakHour.
 *
 * @param patient        Virtual patient parameters
 * @param simTimeMs      Current simulated time (ms since epoch)
 * @param isf            True ISF (mg/dL/U) — scales hepatic output
 * @param currentGlucose Current true BG (mg/dL) for counter-reg calculation
 */
export function calculateEGP(patient, simTimeMs, isf, currentGlucose) {
    const minuteOfDay = (simTimeMs / 60_000) % MINUTES_PER_DAY;
    const hourOfDay = minuteOfDay / 60;
    const phase = TWO_PI * (hourOfDay - patient.egpPeakHour) / 24;
    const amplitude = 1 + patient.egpAmplitude * Math.cos(phase);
    let egpPerMin = patient.egpBasalLevel * amplitude * (isf / 40);
    // Counter-regulatory boost during hypoglycaemia
    if (currentGlucose !== undefined && currentGlucose < CR_ONSET_BG) {
        // Integrity: 1.0 at 0 years T1D, 0.0 at CR_ZERO_YEARS+
        const integrity = Math.max(0, 1 - patient.diabetesDuration / CR_ZERO_YEARS);
        if (integrity > 0) {
            // Linear ramp: 0 at CR_ONSET_BG, 1 at CR_FULL_BG
            const depth = Math.max(0, Math.min(1, (CR_ONSET_BG - currentGlucose) / (CR_ONSET_BG - CR_FULL_BG)));
            egpPerMin *= (1 + integrity * depth * CR_MAX_BOOST);
        }
    }
    return egpPerMin * TICK_MINUTES;
}
//# sourceMappingURL=egp.js.map
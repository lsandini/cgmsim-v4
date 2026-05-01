/**
 * Endogenous Glucose Production (EGP) — faithful port of v3 cgmsim-lib liver.js.
 *
 *   liver_mmol/L/min = (ISF_mmol / CR) × 0.002 × weight × insulinSuppression × sinus
 *   sinus            = 1 + 0.2 × sin(2π × hour / 24)        // ±20%, peak 6 AM
 *   mg/dL/min        = liver × 18  ⇔  (ISF_mgdl / CR) × 0.002 × weight × … × sinus
 *
 * The insulinSuppression factor is the dynamic feedback that makes the model
 * responsive — basal SC insulin can suppress hepatic glucose production by up
 * to 65% via a Hill curve (EC50 at 2× physiological basal flux ≈ 0.0125 U/min
 * for a 70-kg adult). Without it, EGP is a static circadian offset and the
 * controller compensates so completely that parameter changes are invisible.
 *
 * v4-only extension (kept on top of v3): hypoglycemic counter-regulation —
 * EGP boost when BG < 80 mg/dL, scaled by remaining counter-reg integrity
 * (declines linearly with diabetes duration; zero past 30 years T1D).
 */
const TWO_PI = 2 * Math.PI;
const MINUTES_PER_DAY = 24 * 60;
const TICK_MINUTES = 5;
// v3 sinus.js — fixed circadian shape
const AMPLITUDE_FACTOR = 0.2; // ±20%
// peak occurs at hour where sin(2π × h / 24) = 1 → h = 6 (6 AM)
// v3 liver.js — Hill insulin-suppression parameters
const SC_MAX_SUPPRESSION = 0.65; // ceiling: 65% suppression (35% residual)
const SC_HALF_MAX_RATIO = 2.0; // EC50 at 2× physiological basal flux
const SC_HILL_COEFF = 1.5;
const SC_HALF_MAX_POW = SC_HALF_MAX_RATIO ** SC_HILL_COEFF; // pre-computed: hot-path runs every tick
const PHYS_BASAL_PER_KG_PER_HR = 0.01; // U/kg/h baseline pancreatic basal flux
// v4-only counter-regulation (hypo) extension
const CR_ONSET_BG = 80; // mg/dL: response starts here
const CR_FULL_BG = 54; // mg/dL: full response
const CR_MAX_BOOST = 0.8; // up to +80% EGP at full activation
const CR_ZERO_YEARS = 30; // diabetes duration at which CR = 0
/**
 * v3 liver.js insulin-suppression factor (1 = no suppression, 0.35 = max 65%).
 * @param insulinActivity Total insulin activity (U/min)
 * @param weight          Patient weight (kg)
 */
export function calculateInsulinSuppressionFactor(insulinActivity, weight) {
    if (insulinActivity <= 0)
        return 1;
    const physiologicalBasalRate = (PHYS_BASAL_PER_KG_PER_HR * weight) / 60; // U/min
    const activityRatio = insulinActivity / physiologicalBasalRate;
    const r = activityRatio ** SC_HILL_COEFF;
    const suppression = (r / (SC_HALF_MAX_POW + r)) * SC_MAX_SUPPRESSION;
    return Math.max(1 - suppression, 1 - SC_MAX_SUPPRESSION);
}
/**
 * EGP contribution for the current tick (mg/dL).
 *
 * @param patient         Virtual patient parameters
 * @param simTimeMs       Current simulated time (ms since epoch)
 * @param isf             True ISF (mg/dL/U)
 * @param insulinActivity Total insulin activity this tick (U/min) — drives suppression
 * @param currentGlucose  Current true BG (mg/dL) for hypo counter-reg (v4 extension)
 */
export function calculateEGP(patient, simTimeMs, isf, insulinActivity = 0, currentGlucose) {
    const minuteOfDay = (simTimeMs / 60_000) % MINUTES_PER_DAY;
    const hourOfDay = minuteOfDay / 60;
    // v3 sinus: 1 + 0.2 × sin(2π × hour / 24) → 1.0 at midnight, 1.2 at 6 AM, 0.8 at 6 PM
    const sinus = 1 + AMPLITUDE_FACTOR * Math.sin(TWO_PI * hourOfDay / 24);
    // v3 liver formula in mg/dL/min (the 1/18 from isfMmol cancels with the ×18 conversion)
    const suppression = calculateInsulinSuppressionFactor(insulinActivity, patient.weight);
    let egpPerMin = (isf / patient.trueCR) * 0.002 * patient.weight * suppression * sinus;
    // v4 extension: hypo counter-regulation
    if (currentGlucose !== undefined && currentGlucose < CR_ONSET_BG) {
        const integrity = Math.max(0, 1 - patient.diabetesDuration / CR_ZERO_YEARS);
        if (integrity > 0) {
            const depth = Math.max(0, Math.min(1, (CR_ONSET_BG - currentGlucose) / (CR_ONSET_BG - CR_FULL_BG)));
            egpPerMin *= (1 + integrity * depth * CR_MAX_BOOST);
        }
    }
    return egpPerMin * TICK_MINUTES;
}

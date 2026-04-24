/**
 * deltaBG — core tick computation.
 *
 * Computes the signed blood glucose change (mg/dL) for one 5-minute tick
 * as the sum of four independent additive contributions:
 *
 *   deltaBG = -insulinEffect + carbEffect + egpEffect + [noise applied separately]
 *
 * Note: noise is applied by the caller after this function returns, because
 * it requires advancing the stateful G6 AR model.
 *
 * All values in mg/dL.
 */
import { calculateBolusActivity, calculateLongActingActivity, calculatePumpBasalActivity } from './iob.js';
import { calculateCarbEffect } from './carbs.js';
import { calculateEGP } from './egp.js';
const TICK_MINUTES = 5;
export function computeDeltaBG(inputs) {
    const { patient, isf, cr, boluses, longActing, pumpMicroBoluses, meals, nowSimTimeMs, isPump, } = inputs;
    // ── Insulin effect ──────────────────────────────────────────────────────
    const bolusActivity = calculateBolusActivity(boluses, nowSimTimeMs);
    const basalActivity = isPump
        ? calculatePumpBasalActivity(pumpMicroBoluses, nowSimTimeMs)
        : calculateLongActingActivity(longActing, nowSimTimeMs);
    // Activity is in U/min; multiply by ISF × tick duration → mg/dL
    const totalInsulinActivity = bolusActivity + basalActivity;
    const insulinEffect = -(totalInsulinActivity * isf * TICK_MINUTES);
    // ── Carbohydrate effect ─────────────────────────────────────────────────
    const carbEffect = calculateCarbEffect(meals, isf, cr, patient.carbsAbsTime, nowSimTimeMs, TICK_MINUTES);
    // ── Endogenous glucose production ───────────────────────────────────────
    const egpEffect = calculateEGP(patient, nowSimTimeMs, isf, inputs.currentGlucose);
    const deltaBG = insulinEffect + carbEffect + egpEffect;
    return { deltaBG, insulinEffect, carbEffect, egpEffect };
}
//# sourceMappingURL=deltaBG.js.map
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
import {
    calculateBolusActivity,
    calculateLongActingActivity,
    calculatePremixSlowActivity,
    calculatePrednisoneActivity,
    calculatePumpBasalActivity,
} from './iob.js';
import { calculateCarbEffect } from './carbs.js';
import { calculateEGP } from './egp.js';
const TICK_MINUTES = 5;

/** Prednisone Model C calibration constants — see deltaBG.ts for derivation. */
export const K1_PREDNISONE_RESISTANCE = 25;
export const K2_PREDNISONE_HEPATIC    = 25;

export function computeDeltaBG(inputs) {
    const { patient, isf, cr, boluses, longActing, pumpMicroBoluses, meals, prednisoneDoses, nowSimTimeMs, isPump, } = inputs;
    // ── Prednisone activity (Model C input) ─────────────────────────────────
    const prednisoneActivity = (prednisoneDoses && prednisoneDoses.length > 0)
        ? calculatePrednisoneActivity(prednisoneDoses, nowSimTimeMs)
        : 0;
    const isfResistanceDivider = 1 + prednisoneActivity * K1_PREDNISONE_RESISTANCE;
    const effectiveISF = isf / isfResistanceDivider;
    // ── Insulin effect ──────────────────────────────────────────────────────
    // basalActivity must include both long-acting agonists AND NovomixSlow.
    const bolusActivity = calculateBolusActivity(boluses, nowSimTimeMs);
    const basalActivity = isPump
        ? calculatePumpBasalActivity(pumpMicroBoluses, nowSimTimeMs)
        : calculateLongActingActivity(longActing, nowSimTimeMs)
          + calculatePremixSlowActivity(longActing, nowSimTimeMs);
    const totalInsulinActivity = bolusActivity + basalActivity;
    const insulinEffect = -(totalInsulinActivity * effectiveISF * TICK_MINUTES);
    // ── Carbohydrate effect ─────────────────────────────────────────────────
    const carbEffect = calculateCarbEffect(meals, effectiveISF, cr, patient.carbsAbsTime, nowSimTimeMs, TICK_MINUTES);
    // ── Endogenous glucose production (Model C: hepatic boost multiplier) ───
    const baseEGP = calculateEGP(patient, nowSimTimeMs, effectiveISF, totalInsulinActivity, inputs.currentGlucose);
    const egpEffect = baseEGP * (1 + prednisoneActivity * K2_PREDNISONE_HEPATIC);
    const deltaBG = insulinEffect + carbEffect + egpEffect;
    return { deltaBG, insulinEffect, carbEffect, egpEffect };
}

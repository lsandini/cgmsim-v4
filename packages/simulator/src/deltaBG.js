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

/** Prednisone Model C calibration constants — see deltaBG.ts for derivation.
 *  Activity curve uses fixed 15 h duration; K=14 yields ~halved ISF and ~doubled
 *  EGP at peak of a 40 mg dose (matches clinical "double insulin needs" rule). */
export const K1_PREDNISONE_RESISTANCE = 14;
export const K2_PREDNISONE_HEPATIC    = 14;

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
    // Only the insulin BG-lowering uses effectiveISF (resistance term).
    const insulinEffect = -(totalInsulinActivity * effectiveISF * TICK_MINUTES);
    // ── Carbohydrate effect ─────────────────────────────────────────────────
    // Carbs use TRUE ISF — physical glucose load doesn't change with prednisone.
    const carbEffect = calculateCarbEffect(meals, isf, cr, patient.carbsAbsTime, nowSimTimeMs, TICK_MINUTES);
    // ── Endogenous glucose production (Model C: hepatic boost multiplier) ───
    // calculateEGP scales linearly with isf — pass TRUE isf as baseline and
    // apply K2 multiplier on top, otherwise the two effects would cancel.
    const baseEGP = calculateEGP(patient, nowSimTimeMs, isf, totalInsulinActivity, inputs.currentGlucose);
    const egpEffect = baseEGP * (1 + prednisoneActivity * K2_PREDNISONE_HEPATIC);
    const deltaBG = insulinEffect + carbEffect + egpEffect;
    return { deltaBG, insulinEffect, carbEffect, egpEffect };
}

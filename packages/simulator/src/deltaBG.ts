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

import type { VirtualPatient, ActiveBolus, ActiveLongActing, ActivePrednisone } from '@cgmsim/shared';
import {
  calculateBolusActivity,
  calculateLongActingActivity,
  calculatePremixSlowActivity,
  calculatePrednisoneActivity,
  calculatePumpBasalActivity,
} from './iob.js';
import type { PumpBasalBolus } from './iob.js';
import { calculateCarbEffect } from './carbs.js';
import type { ResolvedMeal } from './carbs.js';
import { calculateEGP } from './egp.js';

const TICK_MINUTES = 5;

/**
 * Prednisone Model C — hybrid effect calibration constants (mg-based activity).
 *
 *  K1: insulin-resistance coefficient. Effective ISF is divided by
 *      (1 + prednisoneActivity * K1). At peak of a 40 mg dose for a 75 kg
 *      patient, prednisoneActivity ≈ 0.04 → K1=25 yields a 50% effective-ISF
 *      reduction (insulin works half as well at peak).
 *
 *  K2: hepatic-output multiplier. EGP is multiplied by (1 + prednisoneActivity * K2).
 *      Same peak activity, K2=25 boosts hepatic glucose output by ~100% at peak,
 *      contributing ~30 mg/dL/h additional fasted-state rise on top of baseline.
 *
 * These are starting values from the brainstorm; tune empirically in Phase 4
 * if behaviour feels off in the classroom demo.
 */
export const K1_PREDNISONE_RESISTANCE = 25;
export const K2_PREDNISONE_HEPATIC    = 25;

export interface DeltaBGInputs {
  patient: VirtualPatient;
  isf: number;
  cr: number;
  boluses: ActiveBolus[];
  longActing: ActiveLongActing[];
  pumpMicroBoluses: PumpBasalBolus[];
  meals: ResolvedMeal[];
  /** Active oral prednisone doses — drives Model C (insulin resistance + hepatic boost). */
  prednisoneDoses?: ActivePrednisone[];
  nowSimTimeMs: number;
  isPump: boolean;
  /** Current true BG for counter-regulatory EGP calculation */
  currentGlucose?: number;
}

export interface DeltaBGResult {
  deltaBG: number;           // Total BG change this tick (mg/dL), before noise
  insulinEffect: number;     // Negative contribution (mg/dL)
  carbEffect: number;        // Positive contribution (mg/dL)
  egpEffect: number;         // Typically positive (mg/dL)
}

export function computeDeltaBG(inputs: DeltaBGInputs): DeltaBGResult {
  const {
    patient, isf, cr,
    boluses, longActing, pumpMicroBoluses, meals,
    prednisoneDoses,
    nowSimTimeMs, isPump,
  } = inputs;

  // ── Prednisone activity (Model C input) ─────────────────────────────────
  // mg-equivalent / min — used both for the insulin-resistance ISF divider
  // and for the hepatic-output EGP multiplier.
  const prednisoneActivity = prednisoneDoses && prednisoneDoses.length > 0
    ? calculatePrednisoneActivity(prednisoneDoses, nowSimTimeMs)
    : 0;
  const isfResistanceDivider = 1 + prednisoneActivity * K1_PREDNISONE_RESISTANCE;
  const effectiveISF = isf / isfResistanceDivider;

  // ── Insulin effect ──────────────────────────────────────────────────────
  // basalActivity must include BOTH long-acting agonists AND the NovomixSlow
  // protaminated 70% component. The renderer reports them separately for the
  // stacked strip; here we sum so the BG calc accounts for all background
  // insulin still resolving in the body.
  const bolusActivity = calculateBolusActivity(boluses, nowSimTimeMs);
  const basalActivity = isPump
    ? calculatePumpBasalActivity(pumpMicroBoluses, nowSimTimeMs)
    : calculateLongActingActivity(longActing, nowSimTimeMs)
      + calculatePremixSlowActivity(longActing, nowSimTimeMs);

  // Activity is in U/min; multiply by effective ISF × tick duration → mg/dL.
  // Effective ISF degrades with prednisone on board (Model C resistance term).
  const totalInsulinActivity = bolusActivity + basalActivity;
  const insulinEffect = -(totalInsulinActivity * effectiveISF * TICK_MINUTES);

  // ── Carbohydrate effect ─────────────────────────────────────────────────
  // Carb response also flows through effective ISF — meals raise BG more when
  // insulin sensitivity is degraded by prednisone.
  const carbEffect = calculateCarbEffect(
    meals, effectiveISF, cr, patient.carbsAbsTime, nowSimTimeMs, TICK_MINUTES,
  );

  // ── Endogenous glucose production ───────────────────────────────────────
  // v3-faithful: pass total insulin activity so EGP feels SC-insulin suppression.
  // Model C hepatic boost: EGP is multiplied by (1 + prednisoneActivity * K2).
  const baseEGP = calculateEGP(patient, nowSimTimeMs, effectiveISF, totalInsulinActivity, inputs.currentGlucose);
  const egpEffect = baseEGP * (1 + prednisoneActivity * K2_PREDNISONE_HEPATIC);

  const deltaBG = insulinEffect + carbEffect + egpEffect;

  return { deltaBG, insulinEffect, carbEffect, egpEffect };
}

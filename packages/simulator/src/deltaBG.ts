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
 * Activity curve is biexponential with FIXED 15 h duration (peak at 5 h post
 * dose) — see injectPrednisone in inline-simulator.ts. Peak activity for a
 * 40 mg dose ≈ 0.072 (mg-eq/min).
 *
 *  K1: insulin-resistance coefficient. Effective ISF = trueISF / (1 + activity·K1).
 *      K1=14 at peak → divider ≈ 2.0 → effective ISF halved (insulin at 50%
 *      potency, matches "doubled insulin needs" clinical rule of thumb).
 *
 *  K2: hepatic-output multiplier. EGP × (1 + activity·K2).
 *      K2=14 at peak → EGP ≈ 2× (matches "fasted hyperglycemia" clinical add).
 *
 * Both effects scale linearly with dose: 20 mg gives half the peak shift,
 * 60 mg gives 50% more. Time profile is invariant.
 */
export const K1_PREDNISONE_RESISTANCE = 14;
export const K2_PREDNISONE_HEPATIC    = 14;

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
  // Effective ISF degrades with prednisone on board — this is the Model C
  // resistance term (only the insulin BG-lowering uses the degraded ISF).
  const totalInsulinActivity = bolusActivity + basalActivity;
  const insulinEffect = -(totalInsulinActivity * effectiveISF * TICK_MINUTES);

  // ── Carbohydrate effect ─────────────────────────────────────────────────
  // Carbs use TRUE ISF — the physical glucose load doesn't change with
  // prednisone. The "carbs hit harder" lesson emerges naturally from the
  // reduced insulinEffect (smaller negative), not from inflating the carb
  // term itself. Inflating both would double-count the resistance.
  const carbEffect = calculateCarbEffect(
    meals, isf, cr, patient.carbsAbsTime, nowSimTimeMs, TICK_MINUTES,
  );

  // ── Endogenous glucose production ───────────────────────────────────────
  // calculateEGP scales linearly with ISF (egpPerMin = (isf/trueCR)·… ); so
  // passing effectiveISF here would have HALVED baseline EGP, and the
  // K2 multiplier would have brought it right back — net zero hepatic boost.
  // Pass TRUE ISF as the baseline; apply the K2 multiplier separately on top.
  const baseEGP = calculateEGP(patient, nowSimTimeMs, isf, totalInsulinActivity, inputs.currentGlucose);
  const egpEffect = baseEGP * (1 + prednisoneActivity * K2_PREDNISONE_HEPATIC);

  const deltaBG = insulinEffect + carbEffect + egpEffect;

  return { deltaBG, insulinEffect, carbEffect, egpEffect };
}

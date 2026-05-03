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

import type { VirtualPatient, ActiveBolus, ActiveLongActing } from '@cgmsim/shared';
import { calculateBolusActivity, calculateLongActingActivity, calculatePumpBasalActivity } from './iob.js';
import type { PumpBasalBolus } from './iob.js';
import { calculateCarbEffect } from './carbs.js';
import type { ResolvedMeal } from './carbs.js';
import { calculateEGP } from './egp.js';

const TICK_MINUTES = 5;

export interface DeltaBGInputs {
  patient: VirtualPatient;
  isf: number;
  cr: number;
  boluses: ActiveBolus[];
  longActing: ActiveLongActing[];
  pumpMicroBoluses: PumpBasalBolus[];
  meals: ResolvedMeal[];
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
    nowSimTimeMs, isPump,
  } = inputs;

  // ── Insulin effect ──────────────────────────────────────────────────────
  const bolusActivity = calculateBolusActivity(boluses, nowSimTimeMs);
  const basalActivity = isPump
    ? calculatePumpBasalActivity(pumpMicroBoluses, nowSimTimeMs)
    : calculateLongActingActivity(longActing, nowSimTimeMs);

  // Activity is in U/min; multiply by ISF × tick duration → mg/dL
  const totalInsulinActivity = bolusActivity + basalActivity;
  const insulinEffect = -(totalInsulinActivity * isf * TICK_MINUTES);

  // ── Carbohydrate effect ─────────────────────────────────────────────────
  const carbEffect = calculateCarbEffect(
    meals, isf, cr, patient.carbsAbsTime, nowSimTimeMs, TICK_MINUTES,
  );

  // ── Endogenous glucose production ───────────────────────────────────────
  // v3-faithful: pass total insulin activity so EGP feels SC-insulin suppression
  const egpEffect = calculateEGP(patient, nowSimTimeMs, isf, totalInsulinActivity, inputs.currentGlucose);

  const deltaBG = insulinEffect + carbEffect + egpEffect;

  return { deltaBG, insulinEffect, carbEffect, egpEffect };
}

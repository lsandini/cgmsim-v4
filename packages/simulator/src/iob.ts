/**
 * Insulin On Board (IOB) calculator.
 *
 * Handles all active insulin delivery types:
 *   - Rapid-acting boluses (meal / correction)
 *   - Long-acting MDI doses (Glargine, Degludec, Detemir)
 *   - Pump basal micro-boluses
 *
 * All times in simulated ms. All amounts in units.
 */

import type { ActiveBolus, ActiveLongActing } from '@cgmsim/shared';
import { RAPID_PROFILES, LONG_ACTING_PROFILES } from './insulinProfiles.js';
import { getExpTreatmentActivity, getExpTreatmentIOB, getDeltaMinutes, roundTo8Decimals } from './utils.js';

export interface PumpBasalBolus {
  simTimeMs: number;
  units: number;
  /** DIA in hours (from therapy rapid analogue profile). */
  dia: number;
  /** Peak in minutes (from therapy rapid analogue profile). */
  peak: number;
}

// ── Bolus IOB ────────────────────────────────────────────────────────────────

export function calculateBolusActivity(boluses: ActiveBolus[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    boluses.reduce((sum, b) => {
      const profile = RAPID_PROFILES[b.analogue];
      if (!profile) return sum;
      const minAgo = getDeltaMinutes(b.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentActivity({
        peak: profile.peak,
        duration: b.dia * 60,
        minutesAgo: minAgo,
        units: b.units,
      });
    }, 0),
  );
}

export function calculateBolusIOB(boluses: ActiveBolus[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    boluses.reduce((sum, b) => {
      const profile = RAPID_PROFILES[b.analogue];
      if (!profile) return sum;
      const minAgo = getDeltaMinutes(b.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentIOB({
        peak: profile.peak,
        duration: b.dia * 60,
        minutesAgo: minAgo,
        units: b.units,
      });
    }, 0),
  );
}

// ── Long-acting MDI IOB ──────────────────────────────────────────────────────

export function calculateLongActingActivity(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const profile = LONG_ACTING_PROFILES[d.type];
      if (!profile) return sum;
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentActivity({
        peak: profile.peak,
        duration: profile.dia * 60,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}

export function calculateLongActingIOB(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const profile = LONG_ACTING_PROFILES[d.type];
      if (!profile) return sum;
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentIOB({
        peak: profile.peak,
        duration: profile.dia * 60,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}

// ── Pump basal IOB ───────────────────────────────────────────────────────────

export function calculatePumpBasalActivity(microBoluses: PumpBasalBolus[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    microBoluses.reduce((sum, mb) => {
      const minAgo = getDeltaMinutes(mb.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentActivity({
        peak: mb.peak,
        duration: mb.dia * 60,
        minutesAgo: minAgo,
        units: mb.units,
      });
    }, 0),
  );
}

export function calculatePumpBasalIOB(microBoluses: PumpBasalBolus[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    microBoluses.reduce((sum, mb) => {
      const minAgo = getDeltaMinutes(mb.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentIOB({
        peak: mb.peak,
        duration: mb.dia * 60,
        minutesAgo: minAgo,
        units: mb.units,
      });
    }, 0),
  );
}

// ── Combined ─────────────────────────────────────────────────────────────────

export interface TotalInsulinActivity {
  bolusActivity: number;
  basalActivity: number;
  totalActivity: number;
  totalIOB: number;
}

export function calculateTotalInsulin(
  boluses: ActiveBolus[],
  longActing: ActiveLongActing[],
  pumpMicroBoluses: PumpBasalBolus[],
  nowSimTimeMs: number,
  isPump: boolean,
): TotalInsulinActivity {
  const bolusActivity = calculateBolusActivity(boluses, nowSimTimeMs);
  const basalActivity = isPump
    ? calculatePumpBasalActivity(pumpMicroBoluses, nowSimTimeMs)
    : calculateLongActingActivity(longActing, nowSimTimeMs);

  const bolusIOB = calculateBolusIOB(boluses, nowSimTimeMs);
  const basalIOB = isPump
    ? calculatePumpBasalIOB(pumpMicroBoluses, nowSimTimeMs)
    : calculateLongActingIOB(longActing, nowSimTimeMs);

  return {
    bolusActivity,
    basalActivity,
    totalActivity: bolusActivity + basalActivity,
    totalIOB: bolusIOB + basalIOB,
  };
}

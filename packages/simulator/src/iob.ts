/**
 * Insulin On Board (IOB) calculator.
 *
 * Handles all active insulin delivery types:
 *   - Rapid-acting boluses (meal / correction)
 *   - Long-acting MDI doses (GlargineU100, GlargineU300, Detemir, Degludec)
 *   - Pump basal micro-boluses
 *
 * All times in simulated ms. All amounts in units.
 */

import type { ActiveBolus, ActiveLongActing } from '@cgmsim/shared';
import { RAPID_PROFILES } from './insulinProfiles.js';
import { getExpTreatmentActivity, getExpTreatmentIOB, getDeltaMinutes, roundTo8Decimals } from './utils.js';
import type { PumpBasalBolus } from '@cgmsim/shared';

export type { PumpBasalBolus };

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
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentActivity({
        peak: d.peak,
        duration: d.duration,
        minutesAgo: minAgo,
        units: d.units,
      });
    }, 0),
  );
}

export function calculateLongActingIOB(doses: ActiveLongActing[], nowSimTimeMs: number): number {
  return roundTo8Decimals(
    doses.reduce((sum, d) => {
      const minAgo = getDeltaMinutes(d.simTimeMs, nowSimTimeMs);
      return sum + getExpTreatmentIOB({
        peak: d.peak,
        duration: d.duration,
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


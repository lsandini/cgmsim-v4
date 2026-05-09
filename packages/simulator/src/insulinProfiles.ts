/**
 * Biexponential insulin pharmacodynamic profiles.
 * Ported from @lsandini/cgmsim-lib, Nightscout dependencies removed.
 *
 * Each profile defines peak (minutes to max activity) and dia (duration of
 * insulin action in hours). The biexponential activity curve is computed by
 * getExpTreatmentActivity / getExpTreatmentIOB in utils.ts.
 */

import type { RapidAnalogueType, LongActingPKType } from '@cgmsim/shared';

export interface InsulinProfile {
  /** Time to peak activity (minutes). */
  peak: number;
  /** Duration of insulin action (hours). */
  dia: number;
}

/**
 * Long-acting PK profile: dose- and weight-dependent.
 * `duration(units, weight)` returns total activity duration in minutes.
 * `peak(duration)` returns time to peak activity in minutes (often a fixed ratio of duration).
 *
 * Formulas ported verbatim from v3 cgmsim-lib drug.js:14-44.
 */
export interface LongActingPKProfile {
  duration: (units: number, weightKg: number) => number;
  peak: (durationMin: number) => number;
}

// ── Rapid-acting analogues ───────────────────────────────────────────────────

export const RAPID_PROFILES: Record<RapidAnalogueType, InsulinProfile> = {
  /** Fiasp: faster onset, peak ~55 min, DIA ~5 h */
  Fiasp: { peak: 55, dia: 5 },
  /** Lispro (Humalog): peak ~75 min, DIA ~5 h */
  Lispro: { peak: 75, dia: 5 },
  /** Aspart (NovoRapid): peak ~75 min, DIA ~5 h */
  Aspart: { peak: 75, dia: 5 },
};

// ── Long-acting analogues (v3-faithful, dose- and weight-dependent) ──────────

export const LONG_ACTING_PROFILES: Record<LongActingPKType, LongActingPKProfile> = {
  /** Glargine U100 (Lantus). v3 GLA: dur = (22 + 12·U/wt)·60 min; peak = dur/2.5 */
  GlargineU100: {
    duration: (units, weightKg) => (22 + 12 * units / weightKg) * 60,
    peak: (dur) => dur / 2.5,
  },
  /** Glargine U300 (Toujeo). v3 TOU: dur = (24 + 14·U/wt)·60 min; peak = dur/2.5 — longer & flatter than Lantus. */
  GlargineU300: {
    duration: (units, weightKg) => (24 + 14 * units / weightKg) * 60,
    peak: (dur) => dur / 2.5,
  },
  /** Detemir (Levemir). v3 DET: dur = (14 + 24·U/wt)·60 min; peak = dur/3 — strongly dose-dependent. */
  Detemir: {
    duration: (units, weightKg) => (14 + 24 * units / weightKg) * 60,
    peak: (dur) => dur / 3,
  },
  /** Degludec (Tresiba). v3 DEG: dur = 42·60 min (dose-independent); peak = dur/3. */
  Degludec: {
    duration: () => 42 * 60,
    peak: (dur) => dur / 3,
  },
  /** Novomix slow component — protaminated aspart, NPH-like PK. v3 NPH:
   *  dur = (12 + 20·U/wt)·60 min; peak = dur/3.5. Engine-spawned only;
   *  users schedule "Novomix" (the whole premix), and at injection time the
   *  engine pushes 30% as rapid Aspart bolus + 70% under this profile. */
  NovomixSlow: {
    duration: (units, weightKg) => (12 + 20 * units / weightKg) * 60,
    peak: (dur) => dur / 3.5,
  },
};

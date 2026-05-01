/**
 * Biexponential insulin pharmacodynamic profiles.
 * Ported from @lsandini/cgmsim-lib, Nightscout dependencies removed.
 *
 * Each profile defines peak (minutes to max activity) and dia (duration of
 * insulin action in hours). The biexponential activity curve is computed by
 * getExpTreatmentActivity / getExpTreatmentIOB in utils.ts.
 */
// ── Rapid-acting analogues ───────────────────────────────────────────────────
export const RAPID_PROFILES = {
    /** Fiasp: faster onset, peak ~55 min, DIA ~5 h */
    Fiasp: { peak: 55, dia: 5 },
    /** Lispro (Humalog): peak ~75 min, DIA ~5 h */
    Lispro: { peak: 75, dia: 5 },
    /** Aspart (NovoRapid): peak ~75 min, DIA ~5 h */
    Aspart: { peak: 75, dia: 5 },
};
// ── Long-acting analogues (v3-faithful, dose- and weight-dependent) ──────────
export const LONG_ACTING_PROFILES = {
    /** Glargine U100 (Lantus). v3 GLA: dur = (22 + 12·U/wt)·60 min; peak = dur/2.5 */
    GlargineU100: {
        duration: (units, weightKg) => (22 + 12 * units / weightKg) * 60,
        peak: (dur) => dur / 2.5,
    },
    /** Glargine U300 (Toujeo). v3 TOU: dur = (24 + 14·U/wt)·60 min; peak = dur/2.5 */
    GlargineU300: {
        duration: (units, weightKg) => (24 + 14 * units / weightKg) * 60,
        peak: (dur) => dur / 2.5,
    },
    /** Detemir (Levemir). v3 DET: dur = (14 + 24·U/wt)·60 min; peak = dur/3 */
    Detemir: {
        duration: (units, weightKg) => (14 + 24 * units / weightKg) * 60,
        peak: (dur) => dur / 3,
    },
    /** Degludec (Tresiba). v3 DEG: dur = 42·60 min (dose-independent); peak = dur/3. */
    Degludec: {
        duration: () => 42 * 60,
        peak: (dur) => dur / 3,
    },
};

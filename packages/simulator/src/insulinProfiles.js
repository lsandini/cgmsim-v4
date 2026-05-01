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
// ── Long-acting analogues ────────────────────────────────────────────────────
export const LONG_ACTING_PROFILES = {
    /** Glargine U100 (Lantus/Basaglar): very flat, peak ~5–8 h, DIA 24 h */
    Glargine: { peak: 360, dia: 24 },
    /** Degludec (Tresiba): near-peakless, DIA ~42 h */
    Degludec: { peak: 600, dia: 42 },
    /** Detemir (Levemir): mild peak ~6–8 h, DIA 20 h */
    Detemir: { peak: 420, dia: 20 },
};

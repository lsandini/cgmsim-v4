/**
 * Biexponential insulin pharmacodynamic profiles.
 * Ported from @lsandini/cgmsim-lib, Nightscout dependencies removed.
 *
 * Each profile defines peak (minutes to max activity) and dia (duration of
 * insulin action in hours). The biexponential activity curve is computed by
 * getExpTreatmentActivity / getExpTreatmentIOB in utils.ts.
 */
import type { RapidAnalogueType, LongActingType } from '@cgmsim/shared';
export interface InsulinProfile {
    /** Time to peak activity (minutes). */
    peak: number;
    /** Duration of insulin action (hours). */
    dia: number;
}
export declare const RAPID_PROFILES: Record<RapidAnalogueType, InsulinProfile>;
export declare const LONG_ACTING_PROFILES: Record<LongActingType, InsulinProfile>;
//# sourceMappingURL=insulinProfiles.d.ts.map
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
export interface PumpBasalBolus {
    simTimeMs: number;
    units: number;
    /** DIA in hours (from therapy rapid analogue profile). */
    dia: number;
    /** Peak in minutes (from therapy rapid analogue profile). */
    peak: number;
}
export declare function calculateBolusActivity(boluses: ActiveBolus[], nowSimTimeMs: number): number;
export declare function calculateBolusIOB(boluses: ActiveBolus[], nowSimTimeMs: number): number;
export declare function calculateLongActingActivity(doses: ActiveLongActing[], nowSimTimeMs: number): number;
export declare function calculateLongActingIOB(doses: ActiveLongActing[], nowSimTimeMs: number): number;
export declare function calculatePumpBasalActivity(microBoluses: PumpBasalBolus[], nowSimTimeMs: number): number;
export declare function calculatePumpBasalIOB(microBoluses: PumpBasalBolus[], nowSimTimeMs: number): number;
export interface TotalInsulinActivity {
    bolusActivity: number;
    basalActivity: number;
    totalActivity: number;
    totalIOB: number;
}
export declare function calculateTotalInsulin(boluses: ActiveBolus[], longActing: ActiveLongActing[], pumpMicroBoluses: PumpBasalBolus[], nowSimTimeMs: number, isPump: boolean): TotalInsulinActivity;
//# sourceMappingURL=iob.d.ts.map
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
import type { PumpBasalBolus } from './iob.js';
import type { ResolvedMeal } from './carbs.js';
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
}
export interface DeltaBGResult {
    deltaBG: number;
    insulinEffect: number;
    carbEffect: number;
    egpEffect: number;
}
export declare function computeDeltaBG(inputs: DeltaBGInputs): DeltaBGResult;
//# sourceMappingURL=deltaBG.d.ts.map
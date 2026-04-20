/**
 * Carbohydrate absorption model.
 * Ported from @lsandini/cgmsim-lib carbs.ts; adapted for v4 (no Nightscout,
 * deterministic fast/slow split, simulated time).
 *
 * Uses a triangular absorption curve split across fast and slow carb fractions.
 * The split is computed once at meal entry and stored, making the model
 * deterministic after that point (no random calls during the tick loop).
 */
import type { ActiveMeal } from '@cgmsim/shared';
export interface ResolvedMeal {
    id: string;
    simTimeMs: number;
    carbsG: number;
    gastricEmptyingRate: number;
    /** Fast-absorbing carbs (g). Pre-computed at meal entry. */
    fastCarbsG: number;
    /** Slow-absorbing carbs (g). Pre-computed at meal entry. */
    slowCarbsG: number;
}
/**
 * Resolve a meal into fast/slow fractions.
 * Call once when the meal is created; store the result in simulator state.
 *
 * @param meal     The incoming meal event
 * @param random01 A random value in [0,1) — supply from the seeded RNG so
 *                 simulation is reproducible when reset from a saved state.
 */
export declare function resolveMealSplit(meal: ActiveMeal, random01: number): ResolvedMeal;
/**
 * Compute blood glucose rise contribution from all active meals (mg/dL per tick).
 *
 * @param meals         Active meals with pre-resolved carb splits
 * @param isf           True ISF (mg/dL/U) — physiological
 * @param cr            True carbohydrate ratio (g/U) — physiological
 * @param carbsAbsTime  Full absorption window in minutes (default 360)
 * @param nowSimTimeMs  Current simulated time (ms)
 * @param tickMinutes   Tick duration in minutes (always 5)
 */
export declare function calculateCarbEffect(meals: ResolvedMeal[], isf: number, cr: number, carbsAbsTime: number, nowSimTimeMs: number, tickMinutes: number): number;
/**
 * Compute total Carbs On Board (g) across all active meals.
 */
export declare function calculateCOB(meals: ResolvedMeal[], carbsAbsTime: number, nowSimTimeMs: number): number;
/**
 * Purge meals that are fully absorbed (COB ≈ 0).
 */
export declare function purgeAbsorbedMeals(meals: ResolvedMeal[], carbsAbsTime: number, nowSimTimeMs: number): ResolvedMeal[];
//# sourceMappingURL=carbs.d.ts.map
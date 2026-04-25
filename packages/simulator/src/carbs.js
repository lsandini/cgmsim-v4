/**
 * Carbohydrate absorption model.
 * Ported from @lsandini/cgmsim-lib carbs.ts; adapted for v4 (no Nightscout,
 * deterministic fast/slow split, simulated time).
 *
 * Uses a triangular absorption curve split across fast and slow carb fractions.
 * The split is computed once at meal entry and stored, making the model
 * deterministic after that point (no random calls during the tick loop).
 */
import { getDeltaMinutes, roundTo8Decimals } from './utils.js';
/**
 * Resolve a meal into fast/slow fractions.
 * Call once when the meal is created; store the result in simulator state.
 *
 * @param meal     The incoming meal event
 * @param random01 A random value in [0,1) — supply from the seeded RNG so
 *                 simulation is reproducible when reset from a saved state.
 */
export function resolveMealSplit(meal, random01) {
    const total = meal.carbsG;
    const fastPortion = Math.min(random01 * total, 40);
    const remaining = total - fastPortion;
    const fastRatio = 0.1 + random01 * 0.3;
    const fastCarbsG = fastPortion + fastRatio * remaining;
    const slowCarbsG = remaining * (1 - fastRatio);
    return {
        id: meal.id,
        simTimeMs: meal.simTimeMs,
        carbsG: meal.carbsG,
        gastricEmptyingRate: meal.gastricEmptyingRate,
        fastCarbsG,
        slowCarbsG,
    };
}
// ── Triangular absorption rate ────────────────────────────────────────────────
/**
 * Instantaneous absorption rate (g/min) for a triangular curve.
 *
 * The curve rises linearly from 0 to peak at absorptionTime/2,
 * then falls back to 0 at absorptionTime.
 */
function triangleRate(carbs, absorptionTime, minutesAgo) {
    if (minutesAgo < 0 || minutesAgo >= absorptionTime)
        return 0;
    if (minutesAgo < absorptionTime / 2) {
        return (carbs * 4 * minutesAgo) / (absorptionTime * absorptionTime);
    }
    else {
        return (carbs * 4 / absorptionTime) * (1 - minutesAgo / absorptionTime);
    }
}
/**
 * Remaining unabsorbed carbs (g) for a triangular curve at minutesAgo.
 */
function triangleRemaining(carbs, absorptionTime, minutesAgo) {
    if (minutesAgo <= 0)
        return carbs;
    if (minutesAgo >= absorptionTime)
        return 0;
    if (minutesAgo < absorptionTime / 2) {
        return carbs - (2 * carbs / (absorptionTime * absorptionTime)) * (minutesAgo * minutesAgo);
    }
    else {
        return Math.max(0, 2 * carbs -
            (4 * carbs / absorptionTime) *
                (minutesAgo - (minutesAgo * minutesAgo) / (2 * absorptionTime)));
    }
}
// ── Public API ────────────────────────────────────────────────────────────────
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
export function calculateCarbEffect(meals, isf, cr, carbsAbsTime, nowSimTimeMs, tickMinutes) {
    const isfMmol = isf / 18;
    const carbFactor = isfMmol / cr; // (mmol/L)/g
    const fastAbsTime = carbsAbsTime / 6; // ~60 min default
    const slowAbsTime = carbsAbsTime / 1.5; // ~240 min default
    const totalRateGPerMin = meals.reduce((sum, meal) => {
        const minAgo = getDeltaMinutes(meal.simTimeMs, nowSimTimeMs);
        const fast = triangleRate(meal.fastCarbsG, fastAbsTime * meal.gastricEmptyingRate, minAgo);
        const slow = triangleRate(meal.slowCarbsG, slowAbsTime * meal.gastricEmptyingRate, minAgo);
        return sum + fast + slow;
    }, 0);
    // Convert: (mmol/L)/g * g/min * min/tick → mmol/L per tick, then → mg/dL per tick
    const deltaMmolPerTick = carbFactor * totalRateGPerMin * tickMinutes;
    return roundTo8Decimals(deltaMmolPerTick * 18);
}
/**
 * Compute total Carbs On Board (g) across all active meals.
 */
export function calculateCOB(meals, carbsAbsTime, nowSimTimeMs) {
    const fastAbsTime = carbsAbsTime / 6;
    const slowAbsTime = carbsAbsTime / 1.5;
    return roundTo8Decimals(meals.reduce((sum, meal) => {
        const minAgo = getDeltaMinutes(meal.simTimeMs, nowSimTimeMs);
        const remainFast = triangleRemaining(meal.fastCarbsG, fastAbsTime * meal.gastricEmptyingRate, minAgo);
        const remainSlow = triangleRemaining(meal.slowCarbsG, slowAbsTime * meal.gastricEmptyingRate, minAgo);
        return sum + remainFast + remainSlow;
    }, 0));
}
/**
 * Purge meals that are fully absorbed (COB ≈ 0).
 */
export function purgeAbsorbedMeals(meals, carbsAbsTime, nowSimTimeMs) {
    return meals.filter((meal) => {
        const minAgo = getDeltaMinutes(meal.simTimeMs, nowSimTimeMs);
        return minAgo < carbsAbsTime * 1.1 * meal.gastricEmptyingRate;
    });
}
//# sourceMappingURL=carbs.js.map
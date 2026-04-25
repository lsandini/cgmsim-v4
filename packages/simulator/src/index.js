// packages/simulator public API
// The worker file is imported directly by packages/ui via Vite's ?worker syntax.
// This index exports utilities useful for unit testing outside the browser.
export { computeDeltaBG } from './deltaBG.js';
export { calculateCarbEffect, calculateCOB, resolveMealSplit } from './carbs.js';
export { calculateEGP } from './egp.js';
export { DexcomG6Noise, createG6NoiseGenerator } from './g6Noise.js';
export { runPID, rateToMicroBolus } from './pid.js';
export { RAPID_PROFILES, LONG_ACTING_PROFILES } from './insulinProfiles.js';
export { getExpTreatmentActivity, getExpTreatmentIOB } from './utils.js';
//# sourceMappingURL=index.js.map
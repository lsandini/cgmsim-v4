// ============================================================
// CGMSIM v4 — Shared Type Definitions
// All types shared between packages/simulator and packages/ui
// No runtime code; types only.
// ============================================================
export const DEFAULT_PATIENT = {
    weight: 75,
    age: 35,
    gender: 'Male',
    diabetesDuration: 10,
    trueISF: 40,
    trueCR: 12,
    dia: 6,
    tp: 75,
    carbsAbsTime: 360,
    egpBasalLevel: 0.04,
    egpAmplitude: 1.0,
    egpPeakHour: 5,
    gastricEmptyingRate: 1.0,
};
export const DEFAULT_THERAPY_PROFILE = {
    mode: 'AID',
    programmedISF: 40,
    programmedCR: 12,
    basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }],
    rapidAnalogue: 'Fiasp',
    longActingType: 'Glargine',
    longActingDose: 20,
    longActingInjectionTime: 22 * 60,
    glucoseTarget: 100,
    correctionThreshold: 120,
};
//# sourceMappingURL=index.js.map
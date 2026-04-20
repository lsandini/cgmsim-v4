/**
 * Smoke test: run 288 ticks (24 simulated hours) in Node.js
 * and verify glucose stays within physiological bounds.
 *
 * Run with: node --experimental-vm-modules smoke-test.mjs
 * (or via vitest which handles ESM)
 */

// Inline the essential simulation logic for direct Node testing
// (the worker itself can't be directly imported because of `self`)

// ── Biexponential activity ────────────────────────────────────────────────────
function getExpTreatmentActivity({ peak, duration, minutesAgo, units }) {
  if (minutesAgo < 0 || minutesAgo > duration) return 0;
  const tau = peak * (1 - peak / duration) / (1 - 2 * peak / duration);
  const a = 2 * tau / duration;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-duration / tau));
  const actPerUnit = (S / (tau * tau)) * minutesAgo * (1 - minutesAgo / duration) * Math.exp(-minutesAgo / tau);
  return units * actPerUnit;
}

function getExpTreatmentIOB({ peak, duration, minutesAgo, units }) {
  if (minutesAgo < 0) return units;
  if (minutesAgo > duration) return 0;
  const iobFraction = Math.max(0, 1 - minutesAgo / duration);
  const curve = iobFraction * iobFraction * (3 - 2 * iobFraction);
  return units * curve;
}

// ── EGP ───────────────────────────────────────────────────────────────────────
function calculateEGP(patient, simTimeMs, isf) {
  const minuteOfDay = (simTimeMs / 60_000) % (24 * 60);
  const hourOfDay = minuteOfDay / 60;
  const phase = 2 * Math.PI * (hourOfDay - patient.egpPeakHour) / 24;
  const sinFactor = 1 + patient.egpAmplitude * Math.sin(phase);
  return patient.egpBasalLevel * sinFactor * (isf / 40) * 5;
}

// ── Carb effect (simplified for smoke test) ───────────────────────────────────
function carbEffect(meals, isf, cr, carbsAbsTime, nowMs, tickMin) {
  const isfMmol = isf / 18;
  const carbFactor = isfMmol / cr;
  const fastAbs = carbsAbsTime / 6;
  const slowAbs = carbsAbsTime / 1.5;
  let rate = 0;
  for (const meal of meals) {
    const minAgo = (nowMs - meal.simTimeMs) / 60_000;
    if (minAgo < 0 || minAgo > carbsAbsTime) continue;
    const fast = meal.fastCarbsG;
    const slow = meal.slowCarbsG;
    if (minAgo < fastAbs) rate += fast * 4 * minAgo / (fastAbs * fastAbs);
    if (minAgo < slowAbs) rate += slow * 4 * minAgo / (slowAbs * slowAbs);
  }
  return carbFactor * rate * tickMin * 18;
}

// ── Simple pump micro-bolus IOB ───────────────────────────────────────────────
function pumpActivity(micros, nowMs, peak, diaH) {
  return micros.reduce((s, mb) => {
    const minAgo = (nowMs - mb.simTimeMs) / 60_000;
    return s + getExpTreatmentActivity({ peak, duration: diaH * 60, minutesAgo: minAgo, units: mb.units });
  }, 0);
}

// ── Run simulation ────────────────────────────────────────────────────────────
const patient = {
  weight: 75, age: 35, trueISF: 40, trueCR: 12,
  dia: 6, tp: 75, carbsAbsTime: 360,
  egpBasalLevel: 0.006, egpAmplitude: 1.0, egpPeakHour: 5,
  gastricEmptyingRate: 1.0,
};
const BASAL_RATE = 0.8; // U/hr
const TICK_MIN = 5;
const PEAK = 75;
const DIA_H = 6;

let trueGlucose = 100;
let simTimeMs = 0;
const pumpMicros = [];
const meals = [];
const activeBoluses = [];
const results = [];
let failures = 0;

// Inject a 60g meal at hour 2 and hour 8, with appropriately sized boluses
const meal1 = { simTimeMs: 2 * 60 * 60_000, carbsG: 60, fastCarbsG: 22, slowCarbsG: 38 };
const meal2 = { simTimeMs: 8 * 60 * 60_000, carbsG: 70, fastCarbsG: 25, slowCarbsG: 45 };
// Boluses: CR=12 → meal1 = 5U, meal2 = 5.8U
const boluses = [
  { simTimeMs: 2 * 60 * 60_000, units: 5 },
  { simTimeMs: 8 * 60 * 60_000, units: 5.8 },
];

for (let tick = 0; tick < 288; tick++) {
  simTimeMs = tick * TICK_MIN * 60_000;

  // Add meals and boluses at the right time
  if (tick === 24) { meals.push(meal1); activeBoluses.push(boluses[0]); }
  if (tick === 96) { meals.push(meal2); activeBoluses.push(boluses[1]); }

  // Purge old micros and boluses
  pumpMicros.splice(0, pumpMicros.length, ...pumpMicros.filter(
    mb => (simTimeMs - mb.simTimeMs) / 60_000 <= DIA_H * 60
  ));
  activeBoluses.splice(0, activeBoluses.length, ...activeBoluses.filter(
    b => (simTimeMs - b.simTimeMs) / 60_000 <= DIA_H * 60
  ));

  // Add pump micro-bolus
  const microUnits = BASAL_RATE * (TICK_MIN / 60);
  pumpMicros.push({ simTimeMs, units: microUnits });

  const insulinAct = pumpActivity(pumpMicros, simTimeMs, PEAK, DIA_H) +
    activeBoluses.reduce((s, b) => {
      const minAgo = (simTimeMs - b.simTimeMs) / 60_000;
      return s + getExpTreatmentActivity({ peak: PEAK, duration: DIA_H * 60, minutesAgo: minAgo, units: b.units });
    }, 0);
  const insulinEffect = -(insulinAct * patient.trueISF * TICK_MIN);
  const carbEff = carbEffect(meals, patient.trueISF, patient.trueCR, patient.carbsAbsTime, simTimeMs, TICK_MIN);
  const egpEff = calculateEGP(patient, simTimeMs, patient.trueISF);

  const delta = insulinEffect + carbEff + egpEff;
  trueGlucose = Math.max(20, Math.min(600, trueGlucose + delta));
  results.push({ tick, simTimeMs, trueGlucose: Math.round(trueGlucose), delta: Math.round(delta * 10) / 10 });
}

// Report
const values = results.map(r => r.trueGlucose);
const min = Math.min(...values);
const max = Math.max(...values);
const hypos = results.filter(r => r.trueGlucose < 54).length;
const hypers = results.filter(r => r.trueGlucose > 300).length;

console.log('=== CGMSIM v4 Smoke Test — 24h simulation ===');
console.log(`Ticks:      ${results.length}`);
console.log(`Glucose min: ${min} mg/dL   max: ${max} mg/dL`);
console.log(`Hypo ticks (<54):   ${hypos}`);
console.log(`Hyper ticks (>300): ${hypers}`);
console.log(`Start: ${results[0].trueGlucose} mg/dL → End: ${results[results.length - 1].trueGlucose} mg/dL`);

// Sample trace: tick 0, 24, 48, 96, 144, 192, 240, 287
const sample = [0, 24, 48, 96, 120, 144, 192, 240, 287];
console.log('\nSample trace (tick → time → glucose):');
for (const t of sample) {
  const r = results[t];
  const h = Math.floor(r.simTimeMs / 3600_000);
  const m = Math.floor((r.simTimeMs % 3600_000) / 60_000);
  console.log(`  t=${String(t).padStart(3)}  ${String(h).padStart(2)}:${String(m).padStart(2, '0')}  ${r.trueGlucose} mg/dL  (Δ${r.delta > 0 ? '+' : ''}${r.delta})`);
}

// Bounds check
if (min < 20)   { console.error('FAIL: glucose below 20'); failures++; }
if (max > 500)  { console.error('FAIL: glucose above 500'); failures++; }
if (hypos > 30) { console.error('FAIL: too many hypo ticks'); failures++; }
if (hypers > 30){ console.error('FAIL: too many hyper ticks'); failures++; }
if (failures === 0) console.log('\n✅ All checks passed');
else console.log(`\n❌ ${failures} check(s) failed`);

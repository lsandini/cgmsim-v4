/**
 * Smoke test: run 288 ticks (24 simulated hours) without a browser.
 * Validates deltaBG, EGP, IOB/COB math produce physiologically plausible values.
 *
 * Run: node --input-type=module < packages/simulator/src/smoke-test.mjs
 * Or: node packages/simulator/src/smoke-test.mjs
 */

import { computeDeltaBG } from './deltaBG.js';
import { calculateEGP } from './egp.js';
import { calculateCOB, resolveMealSplit } from './carbs.js';
import { calculateBolusIOB } from './iob.js';
import { createG6NoiseGenerator } from './g6Noise.js';
import { DEFAULT_PATIENT, DEFAULT_THERAPY_PROFILE } from '../../shared/src/index.js';

// ── Simulation state ──────────────────────────────────────────────────────────

let simTimeMs = 0;
let trueGlucose = 100; // mg/dL, start in range
const activeBoluses = [];
const activeLongActing = [];
const pumpMicroBoluses = [];
let resolvedMeals = [];
const g6 = createG6NoiseGenerator(42, null);
const patient = { ...DEFAULT_PATIENT };

const TICK_MS = 5 * 60_000;
const TICKS = 288; // 24 hours

let minGlucose = Infinity;
let maxGlucose = -Infinity;
const cgmReadings = [];

// ── Inject a 60g meal at tick 36 (3h in) with a 4U bolus ─────────────────────

const mealTick = 36;
const bolusTick = 36;

// ── Tick loop ─────────────────────────────────────────────────────────────────

for (let tick = 0; tick < TICKS; tick++) {
  // Inject meal and bolus at tick 36
  if (tick === mealTick) {
    const meal = {
      id: 'test-meal',
      simTimeMs,
      carbsG: 60,
      gastricEmptyingRate: 1.0,
    };
    resolvedMeals.push(resolveMealSplit(meal, 0.4));
    activeBoluses.push({
      id: 'test-bolus',
      simTimeMs,
      units: 4,
      analogue: 'Fiasp',
    });
  }

  // Purge expired
  resolvedMeals = resolvedMeals.filter(
    m => (simTimeMs - m.simTimeMs) / 60_000 < patient.carbsAbsTime * 1.1
  );

  // Compute delta
  const delta = computeDeltaBG({
    patient,
    isf: patient.trueISF,
    cr: patient.trueCR,
    boluses: activeBoluses,
    longActing: activeLongActing,
    pumpMicroBoluses,
    meals: resolvedMeals,
    nowSimTimeMs: simTimeMs,
    isPump: false, // MDI for this test
  });

  // Apply to true glucose
  trueGlucose = Math.max(20, Math.min(600, trueGlucose + delta.deltaBG));

  // Apply sensor model
  const cgm = Math.max(40, Math.min(400, Math.round(
    g6.applySensorModel(trueGlucose, simTimeMs)
  )));

  minGlucose = Math.min(minGlucose, trueGlucose);
  maxGlucose = Math.max(maxGlucose, trueGlucose);
  cgmReadings.push(cgm);

  // Log every 12 ticks (1 hour)
  if (tick % 12 === 0) {
    const hours = Math.floor(simTimeMs / 3_600_000);
    const mins = Math.floor((simTimeMs % 3_600_000) / 60_000);
    const iob = calculateBolusIOB(activeBoluses, simTimeMs).toFixed(2);
    const cob = calculateCOB(resolvedMeals, patient.carbsAbsTime, simTimeMs).toFixed(1);
    console.log(
      `T+${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}` +
      `  CGM=${String(cgm).padStart(3)} mg/dL` +
      `  true=${trueGlucose.toFixed(1).padStart(6)}` +
      `  delta=${delta.deltaBG.toFixed(2).padStart(7)}` +
      `  IOB=${iob}U  COB=${cob}g` +
      `  EGP=${delta.egpEffect.toFixed(2)}`
    );
  }

  simTimeMs += TICK_MS;
}

// ── Assertions ────────────────────────────────────────────────────────────────

console.log('\n── Results ──────────────────────────────────────────────────');
console.log(`Min glucose: ${minGlucose.toFixed(1)} mg/dL  (${(minGlucose/18.0182).toFixed(1)} mmol/L)`);
console.log(`Max glucose: ${maxGlucose.toFixed(1)} mg/dL  (${(maxGlucose/18.0182).toFixed(1)} mmol/L)`);
console.log(`Final glucose: ${trueGlucose.toFixed(1)} mg/dL`);
console.log(`Readings: ${cgmReadings.length}`);

const PASS = (label, cond) => console.log(`${cond ? '✅' : '❌'} ${label}`);

PASS('Glucose stays > 40 mg/dL (no crash)', minGlucose >= 40);
PASS('Glucose stays < 400 mg/dL (no runaway)', maxGlucose <= 400);
PASS('Post-meal peak > 120 mg/dL (carbs have effect)', maxGlucose >= 120);
PASS('Glucose returns below 200 mg/dL by end of 24h', trueGlucose <= 200);
PASS('288 ticks produced', cgmReadings.length === TICKS);

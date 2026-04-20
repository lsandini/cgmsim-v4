/**
 * CGMSIM v4 — Main UI entry point
 *
 * Wires together:
 *   - WorkerBridge (simulation engine)
 *   - CGMRenderer (canvas)
 *   - DOM controls (throttle, pause/resume, quick inject, panel, settings)
 *
 * Vanilla TypeScript — no framework. Direct DOM manipulation via typed refs.
 */

import type { TickSnapshot, DisplayUnit } from '@cgmsim/shared';
import { InlineSimulator } from './inline-simulator.js';
import { CGMRenderer } from './canvas-renderer.js';

// ── Global error surface ─────────────────────────────────────────────────────
// Makes errors visible in the UI, not just the console

window.addEventListener('error', (e) => {
  console.error('Global error:', e.message, e.filename, e.lineno);
  showError(`JS Error: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  showError(`Promise rejection: ${e.reason}`);
});

function showError(msg: string): void {
  let el = document.getElementById('error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#da3633;color:#fff;padding:8px 16px;font:13px monospace;z-index:9999;white-space:pre-wrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

// ── Throttle speed map ───────────────────────────────────────────────────────

const THROTTLE_STOPS = [0.25, 0.5, 1, 5, 10, 50, 100] as const;
type ThrottleStop = typeof THROTTLE_STOPS[number];

function sliderToThrottle(sliderVal: number): ThrottleStop {
  return THROTTLE_STOPS[Math.min(sliderVal, THROTTLE_STOPS.length - 1)] ?? 10;
}

function throttleLabel(t: number): string {
  return t < 1 ? `×${t}` : `×${t}`;
}

// ── Trend arrow ──────────────────────────────────────────────────────────────

function trendArrow(mgdlPerMin: number): string {
  if (mgdlPerMin > 3)  return '↑↑';
  if (mgdlPerMin > 1)  return '↑';
  if (mgdlPerMin > 0.3) return '↗';
  if (mgdlPerMin < -3) return '↓↓';
  if (mgdlPerMin < -1) return '↓';
  if (mgdlPerMin < -0.3) return '↘';
  return '→';
}

// ── Simulated time formatter ─────────────────────────────────────────────────

function formatSimTime(simTimeMs: number): string {
  const totalMinutes = Math.floor(simTimeMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  return `D+${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// ── App state ────────────────────────────────────────────────────────────────

interface AppState {
  running: boolean;
  throttle: ThrottleStop;
  displayUnit: DisplayUnit;
  panelOpen: boolean;
  lastSnap: TickSnapshot | null;
}

const state: AppState = {
  running: false,
  throttle: 10,
  displayUnit: 'mgdl',
  panelOpen: false,
  lastSnap: null,
};

// ── DOM element refs ─────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

const canvas = getEl<HTMLCanvasElement>('cgm-canvas');
const btnPause = getEl<HTMLButtonElement>('btn-pause');
const throttleSlider = getEl<HTMLInputElement>('throttle-slider');
const throttleVal = getEl<HTMLElement>('throttle-val');
const simTimeEl = getEl<HTMLElement>('sim-time');
const currentCGMEl = getEl<HTMLElement>('current-cgm');
const cgmUnitEl = getEl<HTMLElement>('cgm-unit');
const trendArrowEl = getEl<HTMLElement>('trend-arrow');
const iobVal = getEl<HTMLElement>('iob-val');
const cobVal = getEl<HTMLElement>('cob-val');
const unitToggle = getEl<HTMLButtonElement>('unit-toggle');
const btnPanel = getEl<HTMLButtonElement>('btn-panel');
const sidePanel = getEl<HTMLElement>('side-panel');
const btnBolus = getEl<HTMLButtonElement>('btn-bolus');
const btnMeal = getEl<HTMLButtonElement>('btn-meal');
const btnQuickMeal = getEl<HTMLButtonElement>('btn-quick-meal');
const btnQuickBolus = getEl<HTMLButtonElement>('btn-quick-bolus');
const bolusAmount = getEl<HTMLInputElement>('bolus-amount');
const mealCarbs = getEl<HTMLInputElement>('meal-carbs');

// Therapy inputs
const therapyMode = getEl<HTMLSelectElement>('therapy-mode');
const glucoseTarget = getEl<HTMLInputElement>('glucose-target');
const progISF = getEl<HTMLInputElement>('prog-isf');
const progCR = getEl<HTMLInputElement>('prog-cr');
const basalRate = getEl<HTMLInputElement>('basal-rate');

// Patient inputs
const trueISF = getEl<HTMLInputElement>('true-isf');
const trueCR = getEl<HTMLInputElement>('true-cr');
const egpAmp = getEl<HTMLInputElement>('egp-amp');
const egpPeak = getEl<HTMLInputElement>('egp-peak');

// Overlay checkboxes
const overlayIOB = getEl<HTMLInputElement>('overlay-iob');
const overlayCOB = getEl<HTMLInputElement>('overlay-cob');
const overlayTrue = getEl<HTMLInputElement>('overlay-true');

// ── Initialise ───────────────────────────────────────────────────────────────

const bridge = new InlineSimulator();
const renderer = new CGMRenderer(canvas);
renderer.start();

// ── Tick handler ─────────────────────────────────────────────────────────────

bridge.onTick((snap) => {
  state.lastSnap = snap;
  renderer.pushTick(snap);
  updateHUD(snap);
});

function updateHUD(snap: TickSnapshot): void {
  // Sim time
  simTimeEl.textContent = formatSimTime(snap.simTimeMs);

  // Current CGM
  const cgmDisplay = state.displayUnit === 'mmoll'
    ? (snap.cgm / 18.0182).toFixed(1)
    : String(Math.round(snap.cgm));
  currentCGMEl.textContent = cgmDisplay;

  // Zone colour on CGM readout
  currentCGMEl.className = snap.cgm < 54 ? 'hypo-l2' : snap.cgm < 70 ? 'hypo-l1' : '';

  // Trend
  trendArrowEl.textContent = trendArrow(snap.trend);

  // IOB / COB
  iobVal.textContent = snap.iob.toFixed(2);
  cobVal.textContent = snap.cob.toFixed(0);
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

function setRunning(running: boolean): void {
  state.running = running;
  btnPause.textContent = running ? '⏸' : '▶';
  btnPause.classList.toggle('running', running);
}

btnPause.addEventListener('click', () => {
  if (state.running) {
    bridge.pause();
    setRunning(false);
  } else {
    bridge.resume();
    setRunning(true);
  }
});

// ── Throttle ──────────────────────────────────────────────────────────────────

throttleSlider.addEventListener('input', () => {
  const t = sliderToThrottle(parseInt(throttleSlider.value));
  state.throttle = t;
  throttleVal.textContent = throttleLabel(t);
  bridge.setThrottle(t);
});

// Set initial label
throttleVal.textContent = throttleLabel(sliderToThrottle(parseInt(throttleSlider.value)));

// ── Unit toggle ───────────────────────────────────────────────────────────────

unitToggle.addEventListener('click', () => {
  state.displayUnit = state.displayUnit === 'mgdl' ? 'mmoll' : 'mgdl';
  renderer.options.displayUnit = state.displayUnit;
  unitToggle.textContent = state.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  cgmUnitEl.textContent = state.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  if (state.lastSnap) updateHUD(state.lastSnap);
  renderer.markDirty(); // force redraw
});

// ── Side panel ────────────────────────────────────────────────────────────────

btnPanel.addEventListener('click', () => {
  state.panelOpen = !state.panelOpen;
  sidePanel.classList.toggle('open', state.panelOpen);
});

// ── Quick inject buttons ──────────────────────────────────────────────────────

btnQuickMeal.addEventListener('click', () => bridge.meal(60));
btnQuickBolus.addEventListener('click', () => bridge.bolus(4));

btnBolus.addEventListener('click', () => {
  const units = parseFloat(bolusAmount.value);
  if (isNaN(units) || units <= 0) return;
  bridge.bolus(units);
});

btnMeal.addEventListener('click', () => {
  const carbs = parseFloat(mealCarbs.value);
  if (isNaN(carbs) || carbs <= 0) return;
  bridge.meal(carbs);
});

// ── Therapy parameter changes ─────────────────────────────────────────────────

function onTherapyChange(): void {
  bridge.setTherapyParam({
    mode: therapyMode.value as 'AID' | 'PUMP' | 'MDI',
    glucoseTarget: parseFloat(glucoseTarget.value),
    programmedISF: parseFloat(progISF.value),
    programmedCR: parseFloat(progCR.value),
    basalProfile: [{ timeMinutes: 0, rateUPerHour: parseFloat(basalRate.value) }],
  });
}

therapyMode.addEventListener('change', onTherapyChange);
glucoseTarget.addEventListener('change', onTherapyChange);
progISF.addEventListener('change', onTherapyChange);
progCR.addEventListener('change', onTherapyChange);
basalRate.addEventListener('change', onTherapyChange);

// ── Patient parameter changes ─────────────────────────────────────────────────

function onPatientChange(): void {
  bridge.setPatientParam({
    trueISF: parseFloat(trueISF.value),
    trueCR: parseFloat(trueCR.value),
    egpAmplitude: parseFloat(egpAmp.value),
    egpPeakHour: parseFloat(egpPeak.value),
  });
}

trueISF.addEventListener('change', onPatientChange);
trueCR.addEventListener('change', onPatientChange);
egpAmp.addEventListener('change', onPatientChange);
egpPeak.addEventListener('change', onPatientChange);

// ── Overlay toggles ───────────────────────────────────────────────────────────

overlayIOB.addEventListener('change', () => {
  renderer.options.showIOB = overlayIOB.checked;
  renderer.markDirty();
});
overlayCOB.addEventListener('change', () => {
  renderer.options.showCOB = overlayCOB.checked;
  renderer.markDirty();
});
overlayTrue.addEventListener('change', () => {
  renderer.options.showTrueGlucose = overlayTrue.checked;
  renderer.markDirty();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

  switch (e.key) {
    case ' ':
    case 'p':
      e.preventDefault();
      btnPause.click();
      break;
    case 'ArrowRight': {
      const cur = parseInt(throttleSlider.value);
      if (cur < THROTTLE_STOPS.length - 1) {
        throttleSlider.value = String(cur + 1);
        throttleSlider.dispatchEvent(new Event('input'));
      }
      break;
    }
    case 'ArrowLeft': {
      const cur = parseInt(throttleSlider.value);
      if (cur > 0) {
        throttleSlider.value = String(cur - 1);
        throttleSlider.dispatchEvent(new Event('input'));
      }
      break;
    }
    case 'm':
      bridge.meal(60);
      break;
    case 'b':
      bridge.bolus(parseFloat(bolusAmount.value) || 4);
      break;
    case 'u':
      unitToggle.click();
      break;
  }
});

// ── Auto-start at ×10 ────────────────────────────────────────────────────────

bridge.setThrottle(10);
bridge.resume();
setRunning(true);

import type { Prescription, WorkerState } from '@cgmsim/shared';
import { DEFAULT_PRESCRIPTION } from '@cgmsim/shared';
import { InlineSimulator } from '../inline-simulator.js';
import { CGMRenderer, setRendererTheme } from '../canvas-renderer.js';
import { createMobileLayout } from './mobile-layout.js';
import { mountOnboarding, getStoredCaseId, setStoredCaseId, applyCaseToSim } from './mobile-onboarding.js';
import { createActionSheet } from './mobile-action-sheet.js';
import { createSettingsSheet, loadPrefs } from './mobile-settings-sheet.js';
import { mountPrescriptionSheet, loadPrescription } from './mobile-prescription-sheet.js';
import { createSpeedControl } from './mobile-speed.js';
import { attachCanvasGestures } from './mobile-gestures.js';
import './mobile-styles.css';

setRendererTheme('dark');

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('cgm-canvas') as HTMLCanvasElement;
if (!app || !canvas) throw new Error('mobile: #app or #cgm-canvas not found');

const sim = new InlineSimulator();
const renderer = new CGMRenderer(canvas);

// Load persisted prefs before applying to renderer
const prefs = loadPrefs();

renderer.options.displayUnit = prefs.displayUnit;
renderer.options.therapyMode = 'MDI';
// Mobile defaults — overlays the renderer SHOULDN'T draw on the canvas because
// they're presented as top-pill overlays (IOB/COB) instead. The basal strip
// (showBasal=false) leaves a wasteful ~92px PAD_BOTTOM gap because CGMRenderer
// hardcodes PAD_BOTTOM around the assumption a basal panel is shown. Acceptable
// for v1; if mobile chart cropping becomes visible, narrow PAD_BOTTOM via a
// renderer-side option in a future task.
renderer.options.showBasal = false; // Mobile drops the basal strip overlay
renderer.options.showIOB = false;   // IOB shown as a top-pill instead of an overlay
renderer.options.showCOB = false;   // Same as IOB
renderer.options.showForecast = prefs.ar2;
renderer.options.showTrueGlucose = prefs.trueGlucose;

renderer.setZoom(prefs.lastZoom);
renderer.start();

const layout = createMobileLayout(app);
layout.setDisplayUnit(prefs.displayUnit);

const speed = createSpeedControl({
  sim,
  pill: layout.speedPill,
  host: app,
  initialThrottle: 360,
});

const actionSheet = createActionSheet(app, {
  onMeal: (carbsG, gastricEmptyingRate) => sim.meal(carbsG, gastricEmptyingRate, renderer.displayedSimTime),
  onBolus: (units) => sim.bolus(units, undefined, renderer.displayedSimTime),
  onLongActing: (type, units) => sim.injectLongActingNow(type, units),
});
layout.fab.addEventListener('click', () => actionSheet.open());

// Canvas gestures: single-tap → toggle pause; tap near marker → popover; zoom persisted.
attachCanvasGestures({
  canvas,
  renderer,
  onSingleTap: () => speed.setRunning(!speed.isRunning()),
  hostForPopover: app,
});

sim.onTick((snap) => {
  renderer.pushTick(snap);
  layout.applyTick(snap);
});
sim.onEvent((evs) => renderer.pushEvents(evs));

const rawSubmode = localStorage.getItem('cgmsim.mobile.submode');
let submode: 'LIVE' | 'PRESCRIPTION' = rawSubmode === 'PRESCRIPTION' ? 'PRESCRIPTION' : 'LIVE';
const prescription = loadPrescription();

function applySubmode(s: 'LIVE' | 'PRESCRIPTION') {
  submode = s;
  localStorage.setItem('cgmsim.mobile.submode', s);
  sim.setTherapyParam({ mdiSubmode: s, prescription });
}
function applyPrescriptionChange(p: Prescription) {
  sim.setTherapyParam({ prescription: p });
}

/** Returns a canonical fresh WorkerState for starting or restarting the sim. */
function freshSimState(): WorkerState {
  const seed = (Date.now() ^ (Math.random() * 0xFFFF_FFFF) >>> 0) || 1;
  return {
    simTimeMs: 6 * 60 * 60_000,   // 06:00 simulated start
    trueGlucose: 100,
    lastCGM: 100,
    patient: { weight: 75, diabetesDuration: 10, trueISF: 40, trueCR: 12,
               dia: 6, carbsAbsTime: 360, gastricEmptyingRate: 1 },
    therapy: { mode: 'MDI', basalProfile: [{ timeMinutes: 0, rateUPerHour: 0.8 }],
               rapidAnalogue: 'Fiasp', rapidDia: 5,
               longActingMorning: null, longActingEvening: null,
               glucoseTarget: 100, enableSMB: false,
               mdiSubmode: 'LIVE',
               prescription: JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION)) },
    g6State: { v: [0, 0], cc: [0, 0], tCalib: 0, rng: { jsr: 123456789 ^ seed, seed } },
    activeBoluses: [], activeLongActing: [],
    resolvedMeals: [], pumpMicroBoluses: [], tempBasal: null, events: [],
    rngState: seed,
    lastMorningDay: -1, lastEveningDay: -1, prescriptionLastFiredDay: {},
    pidCGMHistory: [], pidPrevRate: 0.8, pidTicksSinceLastMB: 999,
    throttle: 360, running: false,
  };
}

function startSim(caseId: ReturnType<typeof getStoredCaseId>) {
  if (!caseId) return;
  sim.reset(freshSimState());
  applyCaseToSim(sim, caseId);
  applySubmode(submode);
  speed.setThrottle(360);
  speed.setRunning(true);
}

let teardownOnboarding: (() => void) | null = null;

function openOnboarding() {
  speed.setRunning(false);   // stop ticking while the case picker is open
  teardownOnboarding?.();
  teardownOnboarding = mountOnboarding(app, (picked) => {
    setStoredCaseId(picked);
    teardownOnboarding?.();
    teardownOnboarding = null;
    speed.setRunning(false);   // double-pause is harmless
    sim.reset(freshSimState());
    applyCaseToSim(sim, picked);
    applySubmode(submode);
    renderer.clearHistory();
    speed.setRunning(true);
  });
}

function restartSim() {
  const caseId = getStoredCaseId();
  if (!caseId) { openOnboarding(); return; }
  speed.setRunning(false);
  sim.reset(freshSimState());
  applyCaseToSim(sim, caseId);
  applySubmode(submode);
  renderer.clearHistory();
  speed.setRunning(true);
}


const settingsSheet = createSettingsSheet(app, {
  sim,
  renderer,
  prefs,
  setDisplayUnit: (u) => layout.setDisplayUnit(u),
  reopenOnboarding: openOnboarding,
  restartSim,
  submode,
  setSubmode: applySubmode,
  openPrescriptionSheet: () => mountPrescriptionSheet(app, prescription, applyPrescriptionChange),
});

layout.hamburger.addEventListener('click', () => settingsSheet.open());

const stored = getStoredCaseId();
if (stored) {
  startSim(stored);
} else {
  teardownOnboarding = mountOnboarding(app, (picked) => {
    setStoredCaseId(picked);
    teardownOnboarding?.();
    teardownOnboarding = null;
    startSim(picked);
  });
}

app.insertAdjacentHTML('beforeend', `
  <div class="m-orientation-guard">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
    <p>Rotate your device to landscape</p>
  </div>
`);

import type { Prescription } from '@cgmsim/shared';
import { InlineSimulator } from '../inline-simulator.js';
import { CGMRenderer, setRendererTheme } from '../canvas-renderer.js';
import { createMobileLayout } from './mobile-layout.js';
import { mountOnboarding, getStoredCaseId, setStoredCaseId, applyCaseToSim } from './mobile-onboarding.js';
import { createActionSheet } from './mobile-action-sheet.js';
import { createSettingsSheet, loadPrefs } from './mobile-settings-sheet.js';
import { mountPrescriptionSheet, loadPrescription } from './mobile-prescription-sheet.js';
import { createSpeedControl } from './mobile-speed.js';
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

function startSim(caseId: ReturnType<typeof getStoredCaseId>) {
  if (!caseId) return;
  applyCaseToSim(sim, caseId);
  applySubmode(submode);
  speed.setThrottle(360);
  sim.resume();
}

let teardownOnboarding: (() => void) | null = null;

function openOnboarding() {
  sim.pause();   // stop ticking while the case picker is open
  teardownOnboarding?.();
  teardownOnboarding = mountOnboarding(app, (picked) => {
    setStoredCaseId(picked);
    teardownOnboarding?.();
    teardownOnboarding = null;
    sim.pause();   // double-pause is harmless
    applyCaseToSim(sim, picked);
    applySubmode(submode);
    sim.resume();
  });
}

function restartSim() {
  const caseId = getStoredCaseId();
  if (!caseId) { openOnboarding(); return; }
  sim.pause();
  applyCaseToSim(sim, caseId);
  applySubmode(submode);
  renderer.clearHistory();
  sim.resume();
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

// Expose for debugging while the rest is built (will be removed in a later task)
(window as any).__mobile = { sim, renderer, layout, actionSheet, settingsSheet, speed };

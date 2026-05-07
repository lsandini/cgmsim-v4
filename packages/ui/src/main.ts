/**
 * CGMSIM v4 — Main UI entry point (Phase 3)
 * Adds: comparison runs, full-screen mode, diabetes duration control
 */

import type { TickSnapshot, DisplayUnit, WorkerState, LongActingSchedule, LongActingType, TherapyProfile, Prescription, MDISubmode, VirtualPatient } from '@cgmsim/shared';
import { DEFAULT_PRESCRIPTION } from '@cgmsim/shared';
import { InlineSimulator } from './inline-simulator.js';
import { CGMRenderer, setRendererTheme } from './canvas-renderer.js';
import { exportSession, importSession, loadUIPrefs, saveUIPrefs,
         loadPanelOverrides, savePanelOverrides, clearPanelOverrides,
         type PanelOverrides } from './storage.js';
import { runOnboarding, ensureOnboardingStyles } from './onboarding/onboarding.js';
import { PATIENT_CASES, buildTherapyForCase, type CaseId, type TherapyChoice, type PatientCase } from './onboarding/cases.js';

// ── Global error surface ──────────────────────────────────────────────────────

window.addEventListener('error', (e) => {
  showError(`JS Error: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`);
});
window.addEventListener('unhandledrejection', (e) => {
  showError(`Promise rejection: ${String(e.reason)}`);
});

function showError(msg: string): void {
  let el = document.getElementById('error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#da3633;color:#fff;padding:8px 16px;font:13px monospace;z-index:9999;white-space:pre-wrap;cursor:pointer;';
    el.addEventListener('click', () => el!.remove());
    document.body.appendChild(el);
  }
  el.textContent = msg + '  (click to dismiss)';
}

// ── Throttle ──────────────────────────────────────────────────────────────────

// Continuous logarithmic slider: position 0..THROTTLE_SLIDER_MAX maps to
// throttle ×1..×3600 via t = exp((pos/MAX) * ln(3600)).
const THROTTLE_MIN = 1;
const THROTTLE_MAX = 3600;
const THROTTLE_SLIDER_MAX = 1000;
const THROTTLE_LN_RANGE = Math.log(THROTTLE_MAX);

// Snap ladder for ArrowLeft / ArrowRight: jump to the next/previous round multiplier.
const THROTTLE_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3600] as const;

function posToThrottle(pos: number): number {
  const clamped = Math.max(0, Math.min(THROTTLE_SLIDER_MAX, pos));
  return Math.exp((clamped / THROTTLE_SLIDER_MAX) * THROTTLE_LN_RANGE);
}

function throttleToPos(t: number): number {
  const clamped = Math.max(THROTTLE_MIN, Math.min(THROTTLE_MAX, t));
  return Math.round((Math.log(clamped) / THROTTLE_LN_RANGE) * THROTTLE_SLIDER_MAX);
}

function formatThrottle(t: number): string {
  if (t < 10)  return `×${Math.round(t)}`;
  if (t < 100) return `×${Math.round(t / 5) * 5}`;
  return `×${Math.round(t / 10) * 10}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSimTime(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const s = m % 60;
  return `D+${String(d).padStart(2,'0')}:${String(h).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateSkyIcon(simTimeMs: number): void {
  const totalMin = Math.floor(simTimeMs / 60_000);
  const hourOfDay = (Math.floor(totalMin / 60) % 24 + 24) % 24;
  let tod: 'day' | 'dawn' | 'dusk' | 'night';
  if (hourOfDay >= 7  && hourOfDay < 17) tod = 'day';
  else if (hourOfDay >= 5 && hourOfDay < 7)  tod = 'dawn';
  else if (hourOfDay >= 17 && hourOfDay < 20) tod = 'dusk';
  else tod = 'night';
  skyIcon.setAttribute('data-tod', tod);
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 22) * 60 + (m ?? 0);
}

function minutesToTimeString(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}

// ── App state ─────────────────────────────────────────────────────────────────

const uiPrefs = loadUIPrefs();

const appState = {
  running:        false,
  throttle:       10 as number,
  displayUnit:    uiPrefs.displayUnit,
  panelOpen:      uiPrefs.panelOpen,
  fullScreen:     false,
  lastSnap:       null as TickSnapshot | null,
  snapshotState:  null as WorkerState | null,   // saved for comparison run
  compareRunning: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

function getEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as unknown as T;
}

const canvas           = getEl<HTMLCanvasElement>('cgm-canvas');
const btnPause         = getEl<HTMLButtonElement>('btn-pause');
const throttleSlider   = getEl<HTMLInputElement>('throttle-slider');
const throttleVal      = getEl<HTMLElement>('throttle-val');
const throttleBubble   = getEl<HTMLElement>('throttle-bubble');
const simTimeEl        = getEl<HTMLElement>('sim-time');
const skyIcon          = getEl<SVGSVGElement>('sky-icon');
const currentCGMEl     = getEl<HTMLElement>('current-cgm');
const bgOverlay        = getEl<HTMLElement>('bg-overlay');
const bgOverlayValue   = getEl<HTMLElement>('bg-overlay-value');
const iobVal           = getEl<HTMLElement>('iob-val');
const cobVal           = getEl<HTMLElement>('cob-val');
const unitToggle       = getEl<HTMLButtonElement>('unit-toggle');
const themeToggle      = getEl<HTMLButtonElement>('theme-toggle');
const btnPanel         = getEl<HTMLButtonElement>('btn-panel');
const btnFullscreen    = getEl<HTMLButtonElement>('btn-fullscreen');
const sidePanel        = getEl<HTMLElement>('side-panel');
const btnStripCarbs    = getEl<HTMLButtonElement>('btn-strip-carbs');
const btnStripBolus    = getEl<HTMLButtonElement>('btn-strip-bolus');
const stripCarbsLabel  = getEl<HTMLSpanElement>('strip-carbs-label');
const stripBolusLabel  = getEl<HTMLSpanElement>('strip-bolus-label');
const therapyMode      = getEl<HTMLSelectElement>('therapy-mode');
const glucoseTarget    = getEl<HTMLInputElement>('glucose-target');
const rapidAnalogue    = getEl<HTMLSelectElement>('rapid-analogue');
const progDIA          = getEl<HTMLInputElement>('prog-dia');
const laRowMorning = getEl<HTMLDivElement>('la-row-morning');
const laRowEvening = getEl<HTMLDivElement>('la-row-evening');
const tempBasalRate    = getEl<HTMLInputElement>('temp-basal-rate');
const tempBasalDur     = getEl<HTMLInputElement>('temp-basal-duration');
const btnSetTemp       = getEl<HTMLButtonElement>('btn-set-temp');
const btnCancelTemp    = getEl<HTMLButtonElement>('btn-cancel-temp');
const trueISF          = getEl<HTMLInputElement>('true-isf');
const trueCR           = getEl<HTMLInputElement>('true-cr');
const trueDIA          = getEl<HTMLInputElement>('true-dia');
const patientWeight    = getEl<HTMLInputElement>('patient-weight');
const diabetesDuration = getEl<HTMLInputElement>('diabetes-duration');
const carbsAbsTime     = getEl<HTMLInputElement>('carbs-abs-time');
const gastricRate      = getEl<HTMLInputElement>('gastric-rate');
const enableSMB        = getEl<HTMLInputElement>('enable-smb');
const rowSMB           = getEl<HTMLElement>('row-smb');
const rowTarget        = getEl<HTMLElement>('row-target');
const rowOverlayBasal  = getEl<HTMLElement>('row-overlay-basal');
const overlayBasal     = getEl<HTMLInputElement>('overlay-basal');
const overlayIOB       = getEl<HTMLInputElement>('overlay-iob');
const overlayCOB       = getEl<HTMLInputElement>('overlay-cob');
const overlayEvents    = getEl<HTMLInputElement>('overlay-events');
const overlayTrue      = getEl<HTMLInputElement>('overlay-true');
const overlayForecast  = getEl<HTMLInputElement>('overlay-forecast');
const overlayBG        = getEl<HTMLInputElement>('overlay-bg');
const btnExport        = getEl<HTMLButtonElement>('btn-export');
const btnImport        = getEl<HTMLButtonElement>('btn-import');
const btnReset         = getEl<HTMLButtonElement>('btn-reset');
const btnZoom3h        = getEl<HTMLButtonElement>('btn-zoom-3h');
const btnZoom6h        = getEl<HTMLButtonElement>('btn-zoom-6h');
const btnZoom12h       = getEl<HTMLButtonElement>('btn-zoom-12h');
const btnZoom24h       = getEl<HTMLButtonElement>('btn-zoom-24h');
const btnLive          = getEl<HTMLButtonElement>('btn-live');
const scenarioModeDD   = getEl<HTMLElement>('scenario-mode-dd');
const scenarioModeBtn  = getEl<HTMLButtonElement>('scenario-mode-btn');
const scenarioModeLbl  = scenarioModeBtn.querySelector<HTMLElement>('.dropdown-label')!;
const scenarioModeMenu = scenarioModeDD.querySelector<HTMLElement>('.dropdown-menu')!;
const btnSnapshot      = getEl<HTMLButtonElement>('btn-snapshot');
const btnRunCompare    = getEl<HTMLButtonElement>('btn-run-compare');
const btnStopCompare   = getEl<HTMLButtonElement>('btn-stop-compare');
const compareLabelA    = getEl<HTMLInputElement>('compare-label-a');
const compareLabelB    = getEl<HTMLInputElement>('compare-label-b');
const sessionStatus    = getEl<HTMLElement>('session-status');
const basalProfileRows = getEl<HTMLElement>('basal-profile-rows');
const btnAddBasal      = getEl<HTMLButtonElement>('btn-add-basal');
const sectionMDI       = getEl<HTMLElement>('section-mdi');
const sectionBasal     = getEl<HTMLElement>('section-basal');
const sectionTempBasal = getEl<HTMLElement>('section-temp-basal');

// MDI submode + prescription modal
const mdiSubmodeGroup  = getEl<HTMLElement>('mdi-submode-group');
const btnEditPresc     = getEl<HTMLButtonElement>('btn-edit-prescription');
const prescBackdrop    = getEl<HTMLElement>('prescription-modal-backdrop');
const prescModal       = getEl<HTMLElement>('prescription-modal');
const prescFasting     = getEl<HTMLInputElement>('presc-fasting');
const prescFastingHelp = getEl<HTMLElement>('presc-fasting-help');
const prescMealsList   = getEl<HTMLElement>('presc-meals');
const prescCorr1       = getEl<HTMLInputElement>('presc-corr-1');
const prescCorr2       = getEl<HTMLInputElement>('presc-corr-2');
const prescCorr3       = getEl<HTMLInputElement>('presc-corr-3');
const btnPrescClose    = getEl<HTMLButtonElement>('btn-prescription-close');
const btnPrescCancel   = getEl<HTMLButtonElement>('btn-prescription-cancel');
const btnPrescSave     = getEl<HTMLButtonElement>('btn-prescription-save');

// ── Simulators ────────────────────────────────────────────────────────────────

const bridge   = new InlineSimulator();   // primary
const compare  = new InlineSimulator();   // comparison (idle until activated)
const renderer = new CGMRenderer(canvas);
renderer.start();

// ── Tick handlers ─────────────────────────────────────────────────────────────

bridge.onTick((snap) => {
  appState.lastSnap = snap;
  renderer.pushTick(snap);
  updateHUD(snap);
});

bridge.onEvent((evs) => renderer.pushEvents(evs));

compare.onTick((snap) => {
  renderer.pushComparisonTick(snap);
});

// ── HUD ───────────────────────────────────────────────────────────────────────

let cgmFlashTimeout: number | undefined;
function updateHUD(snap: TickSnapshot): void {
  simTimeEl.textContent = formatSimTime(snap.simTimeMs);
  updateSkyIcon(snap.simTimeMs);
  const newCgmText = appState.displayUnit === 'mmoll'
    ? (snap.cgm / 18.0182).toFixed(1) : String(Math.round(snap.cgm));
  const valueChanged = currentCGMEl.textContent !== newCgmText;
  const zoneClass = snap.cgm < 54 ? 'hypo-l2' : snap.cgm < 70 ? 'hypo-l1' : '';
  currentCGMEl.textContent = newCgmText;
  currentCGMEl.className = zoneClass;
  bgOverlayValue.textContent = newCgmText;
  bgOverlay.className = zoneClass;
  if (valueChanged) {
    currentCGMEl.classList.add('flash');
    bgOverlay.classList.add('flash');
    if (cgmFlashTimeout !== undefined) window.clearTimeout(cgmFlashTimeout);
    cgmFlashTimeout = window.setTimeout(() => {
      currentCGMEl.classList.remove('flash');
      bgOverlay.classList.remove('flash');
    }, 250);
  }
  iobVal.textContent = snap.iob.toFixed(2);
  cobVal.textContent = snap.cob.toFixed(0);
}

function setStatus(msg: string): void { sessionStatus.textContent = msg; }

function persistUIPrefs(): void {
  saveUIPrefs({
    showIOB:           renderer.options.showIOB,
    showCOB:           renderer.options.showCOB,
    showBasal:         renderer.options.showBasal,
    showEvents:        renderer.options.showEvents,
    showTrueGlucose:   renderer.options.showTrueGlucose,
    showForecast:      renderer.options.showForecast,
    showBgOverlay:     bgOverlay.style.display !== 'none',
    displayUnit:       appState.displayUnit,
    viewWindowMinutes: renderer.zoomMinutes,
    panelOpen:         appState.panelOpen,
    prescription:      currentPrescription,
  });
}

// ── Panel overrides (manual edits to therapy + patient tabs) ────────────────
// Glucose target and trueISF are converted to mg/dL canonical so the snapshot
// stays valid across unit toggles. All other fields are unitless.

function readPanelSnapshot(): PanelOverrides {
  return {
    therapy: {
      mode:               therapyMode.value as 'AID' | 'PUMP' | 'MDI',
      progDIA:            parseFloat(progDIA.value),
      rapidAnalogue:      rapidAnalogue.value as 'Fiasp' | 'Lispro' | 'Aspart',
      enableSMB:          enableSMB.checked,
      basalSegments:      basalSegments.map(s => ({ ...s })),
      longActingMorning:  activeSchedule.morning,
      longActingEvening:  activeSchedule.evening,
      laMorningInputs:    { type: morningRefs.type.value, dose: morningRefs.dose.value, time: morningRefs.time.value },
      laEveningInputs:    { type: eveningRefs.type.value, dose: eveningRefs.dose.value, time: eveningRefs.time.value },
      tempBasalRate:      tempBasalRate.value,
      tempBasalDuration:  tempBasalDur.value,
    },
    patient: {
      trueISFMgdl:         fromDisplay(parseFloat(trueISF.value)),
      trueCR:              parseFloat(trueCR.value),
      trueDIA:             parseFloat(trueDIA.value),
      weight:              parseFloat(patientWeight.value),
      diabetesDuration:    parseFloat(diabetesDuration.value),
      carbsAbsTime:        parseFloat(carbsAbsTime.value),
      gastricEmptyingRate: parseFloat(gastricRate.value),
    },
  };
}

/** Write a snapshot back into the form fields. Caller is responsible for
 *  re-running onTherapyChange / onPatientChange / pushBasalProfile so the
 *  simulator picks up the new values. */
function applyPanelSnapshot(snap: PanelOverrides): void {
  const isMmol = appState.displayUnit === 'mmoll';
  const toDisplay = (mgdl: number): string =>
    isMmol ? (mgdl / 18.0182).toFixed(1) : String(Math.round(mgdl));

  // Therapy. Glucose target is intentionally NOT restored from the snapshot —
  // it is reset to the case template default on every reload / reset.
  therapyMode.value   = snap.therapy.mode;
  progDIA.value       = String(snap.therapy.progDIA);
  rapidAnalogue.value = snap.therapy.rapidAnalogue;
  enableSMB.checked   = snap.therapy.enableSMB;
  basalSegments       = snap.therapy.basalSegments.map(s => ({ ...s }));
  renderBasalRows();

  morningRefs.type.value = snap.therapy.laMorningInputs.type;
  morningRefs.dose.value = snap.therapy.laMorningInputs.dose;
  morningRefs.time.value = snap.therapy.laMorningInputs.time;
  eveningRefs.type.value = snap.therapy.laEveningInputs.type;
  eveningRefs.dose.value = snap.therapy.laEveningInputs.dose;
  eveningRefs.time.value = snap.therapy.laEveningInputs.time;
  setSlot('morning', snap.therapy.longActingMorning);
  setSlot('evening', snap.therapy.longActingEvening);

  tempBasalRate.value = snap.therapy.tempBasalRate;
  tempBasalDur.value  = snap.therapy.tempBasalDuration;

  // Patient
  trueISF.value          = toDisplay(snap.patient.trueISFMgdl);
  trueCR.value           = String(snap.patient.trueCR);
  trueDIA.value          = String(snap.patient.trueDIA);
  patientWeight.value    = String(snap.patient.weight);
  diabetesDuration.value = String(snap.patient.diabetesDuration);
  carbsAbsTime.value     = String(snap.patient.carbsAbsTime);
  gastricRate.value      = String(snap.patient.gastricEmptyingRate);
}

/** True during init / reset / re-onboarding so the persist hooks below don't
 *  re-save case defaults right after we just cleared them. Flipped to false
 *  at the very end of the init IIFE; toggled around reset/re-onboarding. */
let suppressPersist = true;

function persistPanelOverrides(): void {
  if (suppressPersist) return;
  savePanelOverrides(readPanelSnapshot());
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

function setRunning(running: boolean): void {
  appState.running = running;
  btnPause.textContent = running ? '⏸' : '▶';
  btnPause.classList.toggle('running', running);
  renderer.setPlayback(appState.throttle, running);
}

btnPause.addEventListener('click', () => {
  if (appState.running) {
    bridge.pause();
    if (appState.compareRunning) compare.pause();
    setRunning(false);
  } else {
    bridge.resume();
    if (appState.compareRunning) compare.resume();
    setRunning(true);
  }
});

// ── Throttle ──────────────────────────────────────────────────────────────────

// Place the floating bubble centred over the slider thumb.
// Native range thumbs travel from thumbW/2 to width - thumbW/2.
const THROTTLE_THUMB_W = 18;
function updateThrottleBubble(label: string): void {
  throttleBubble.textContent = label;
  const pos = parseInt(throttleSlider.value);
  const frac = pos / THROTTLE_SLIDER_MAX;
  const w = throttleSlider.getBoundingClientRect().width;
  const x = THROTTLE_THUMB_W / 2 + frac * (w - THROTTLE_THUMB_W);
  throttleBubble.style.left = `${x}px`;
}

throttleSlider.addEventListener('input', () => {
  const t = posToThrottle(parseInt(throttleSlider.value));
  appState.throttle = t;
  const label = formatThrottle(t);
  throttleVal.textContent = label;
  updateThrottleBubble(label);
  bridge.setThrottle(t);
  if (appState.compareRunning) compare.setThrottle(t);
  renderer.setPlayback(t, appState.running);
});

const showBubble = (): void => { throttleBubble.classList.add('visible'); updateThrottleBubble(throttleVal.textContent ?? ''); };
const hideBubble = (): void => { throttleBubble.classList.remove('visible'); };
throttleSlider.addEventListener('pointerenter', showBubble);
throttleSlider.addEventListener('pointerleave', hideBubble);
throttleSlider.addEventListener('focus', showBubble);
throttleSlider.addEventListener('blur', hideBubble);
window.addEventListener('resize', () => updateThrottleBubble(throttleVal.textContent ?? ''));

throttleVal.textContent = formatThrottle(posToThrottle(parseInt(throttleSlider.value)));
updateThrottleBubble(throttleVal.textContent);

// ── Zoom and pan controls ─────────────────────────────────────────────────────

function updateZoomButtons(activeMinutes: number): void {
  btnZoom3h.classList.toggle('active',  activeMinutes === 180);
  btnZoom6h.classList.toggle('active',  activeMinutes === 360);
  btnZoom12h.classList.toggle('active', activeMinutes === 720);
  btnZoom24h.classList.toggle('active', activeMinutes === 1440);
}

btnZoom3h.addEventListener('click',  () => { renderer.setZoom(180);  updateZoomButtons(180);  persistUIPrefs(); });
btnZoom6h.addEventListener('click',  () => { renderer.setZoom(360);  updateZoomButtons(360);  persistUIPrefs(); });
btnZoom12h.addEventListener('click', () => { renderer.setZoom(720);  updateZoomButtons(720);  persistUIPrefs(); });
btnZoom24h.addEventListener('click', () => { renderer.setZoom(1440); updateZoomButtons(1440); persistUIPrefs(); });
btnLive.addEventListener('click', () => renderer.snapToLive());

renderer.onViewChange(() => {
  btnLive.hidden = renderer.isLive;
  updateZoomButtons(renderer.zoomMinutes);
});

// ── Unit toggle ───────────────────────────────────────────────────────────────

/** Convert a value from current display unit to mg/dL (for simulator). */
function fromDisplay(val: number): number {
  return appState.displayUnit === 'mmoll' ? val * 18.0182 : val;
}

/** Update panel inputs and unit labels when display unit changes. */
function syncPanelUnits(prevUnit: 'mgdl' | 'mmoll'): void {
  const isMmol = appState.displayUnit === 'mmoll';

  // Convert a value from prevUnit to the new display unit
  const conv = (v: number) => {
    const mgdl = prevUnit === 'mmoll' ? v * 18.0182 : v;
    return isMmol ? mgdl / 18.0182 : mgdl;
  };
  const fmt = (v: number) => isMmol ? v.toFixed(1) : Math.round(v).toString();

  // Glucose target
  const gt = parseFloat(glucoseTarget.value);
  if (!isNaN(gt)) glucoseTarget.value = fmt(conv(gt));
  glucoseTarget.min  = isMmol ? '3.9'  : '70';
  glucoseTarget.max  = isMmol ? '13.9' : '250';
  glucoseTarget.step = isMmol ? '0.1'  : '5';
  document.getElementById('unit-glucose-target')!.textContent = isMmol ? 'mmol/L' : 'mg/dL';

  // True ISF input
  const v = parseFloat(trueISF.value);
  if (!isNaN(v)) trueISF.value = fmt(conv(v));
  trueISF.min  = isMmol ? '0.5'  : '10';
  trueISF.max  = isMmol ? '11.1' : '200';
  trueISF.step = isMmol ? '0.1'  : '5';
  document.getElementById('unit-true-isf')!.textContent = isMmol ? 'mmol/L/U' : 'mg/dL/U';
}

unitToggle.addEventListener('click', () => {
  const prev = appState.displayUnit;
  appState.displayUnit = prev === 'mgdl' ? 'mmoll' : 'mgdl';
  renderer.options.displayUnit = appState.displayUnit;
  unitToggle.textContent = appState.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  syncPanelUnits(prev);
  if (appState.lastSnap) updateHUD(appState.lastSnap);
  renderer.markDirty();
  persistUIPrefs();
});

// ── Theme toggle (light / dark) ─────────────────────────────────────────────
function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.setAttribute('data-theme', theme);
  setRendererTheme(theme);
  themeToggle.textContent = theme === 'light' ? '☀️' : '🌙';
  renderer.markDirty();
}
const savedTheme = (localStorage.getItem('cgmsim.theme') as 'dark' | 'light' | null) ?? 'dark';
applyTheme(savedTheme);
themeToggle.addEventListener('click', () => {
  const next: 'dark' | 'light' = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem('cgmsim.theme', next);
  applyTheme(next);
});

// ── Panel and tabs ────────────────────────────────────────────────────────────

btnPanel.addEventListener('click', () => {
  appState.panelOpen = !appState.panelOpen;
  sidePanel.classList.toggle('open', appState.panelOpen);
  btnPanel.classList.toggle('active', appState.panelOpen);
  persistUIPrefs();
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = (btn as HTMLElement).dataset['tab'];
    if (!tab) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
  });
});

// ── Full-screen mode ──────────────────────────────────────────────────────────

function toggleFullScreen(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {/* permission denied */});
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  appState.fullScreen = !!document.fullscreenElement;
  if (appState.fullScreen) {
    sidePanel.classList.remove('open');
    btnPanel.classList.remove('active');
    appState.panelOpen = false;
  }
  btnFullscreen.textContent = appState.fullScreen ? '⊡' : '⛶';
  renderer.markDirty();
});

btnFullscreen.addEventListener('click', toggleFullScreen);

// ── Quick inject ──────────────────────────────────────────────────────────────
// Bolus / meal stamping uses renderer.displayedSimTime — the sim-time the user
// actually sees on the chart — so the marker lands at the "now" line instantly
// instead of in the lookahead zone where it'd be culled.

// Strip dose state — values shown as the button labels, adjusted by ▲▼ flanks.
let stripCarbsValue = 40;   // grams,  step 5,   bounds 5..150
let stripBolusValue = 3;    // units,  step 0.5, bounds 0.5..20

function renderStripDoses(): void {
  stripCarbsLabel.textContent = `${stripCarbsValue}g`;
  stripBolusLabel.textContent = `${stripBolusValue}U`;
}
renderStripDoses();

function adjustStripDose(target: 'carbs' | 'bolus', dir: 'up' | 'down'): void {
  if (target === 'carbs') {
    const next = stripCarbsValue + (dir === 'up' ? 5 : -5);
    stripCarbsValue = Math.max(5, Math.min(150, next));
  } else {
    const next = stripBolusValue + (dir === 'up' ? 0.5 : -0.5);
    stripBolusValue = Math.max(0.5, Math.min(20, Math.round(next * 2) / 2));
  }
  renderStripDoses();
}

document.querySelectorAll<HTMLButtonElement>('.strip-dose-arrow').forEach((b) => {
  b.addEventListener('click', () => {
    const target = b.dataset['target'] as 'carbs' | 'bolus';
    const dir    = b.dataset['dir']    as 'up'    | 'down';
    adjustStripDose(target, dir);
  });
});

btnStripCarbs.addEventListener('click', () => bridge.meal(stripCarbsValue, undefined, renderer.displayedSimTime));
btnStripBolus.addEventListener('click', () => bridge.bolus(stripBolusValue, undefined, renderer.displayedSimTime));

// ── Long-acting slot helpers ──────────────────────────────────────────────────

type SlotName = 'morning' | 'evening';

interface SlotRowRefs {
  row:    HTMLDivElement;
  type:   HTMLSelectElement;
  dose:   HTMLInputElement;
  time:   HTMLInputElement;
  setBtn: HTMLButtonElement;
}

function getSlotRowRefs(row: HTMLDivElement): SlotRowRefs {
  return {
    row,
    type:   row.querySelector<HTMLSelectElement>('.la-type')!,
    dose:   row.querySelector<HTMLInputElement>('.la-dose')!,
    time:   row.querySelector<HTMLInputElement>('.la-time')!,
    setBtn: row.querySelector<HTMLButtonElement>('.la-set-btn')!,
  };
}

function readSlotSchedule(refs: SlotRowRefs, slot: SlotName): LongActingSchedule | null {
  const dose = parseFloat(refs.dose.value);
  if (!Number.isFinite(dose) || dose < 1 || dose > 80) return null;
  const minute = timeStringToMinutes(refs.time.value);
  if (!Number.isFinite(minute)) return null;
  const lo = slot === 'morning' ? 0 : 12 * 60;
  const hi = slot === 'morning' ? 12 * 60 - 1 : 24 * 60 - 1;
  if (minute < lo || minute > hi) return null;
  return {
    type: refs.type.value as LongActingType,
    units: dose,
    injectionMinute: minute,
  };
}

/** Apply visual + control state for a slot. `schedule` non-null = Active (green, locked). */
function setSlotActiveState(refs: SlotRowRefs, schedule: LongActingSchedule | null): void {
  const isActive = schedule !== null;
  refs.row.classList.toggle('active', isActive);
  refs.type.disabled = isActive;
  refs.dose.disabled = isActive;
  refs.time.disabled = isActive;
  refs.setBtn.textContent = isActive ? 'Edit' : 'Set';
}

function shakeRow(refs: SlotRowRefs): void {
  refs.row.classList.remove('invalid');
  // Force reflow so the animation re-triggers on the next add
  void refs.row.offsetWidth;
  refs.row.classList.add('invalid');
}

const morningRefs = getSlotRowRefs(laRowMorning);
const eveningRefs = getSlotRowRefs(laRowEvening);
const slotRefs: Record<SlotName, SlotRowRefs> = {
  morning: morningRefs,
  evening: eveningRefs,
};

// Track active schedule per slot — null = unset
const activeSchedule: Record<SlotName, LongActingSchedule | null> = {
  morning: null,
  evening: null,
};

function setSlot(slot: SlotName, schedule: LongActingSchedule | null): void {
  activeSchedule[slot] = schedule;
  setSlotActiveState(slotRefs[slot], schedule);
  // Push the full pair into therapy each time
  bridge.setTherapyParam({
    longActingMorning: activeSchedule.morning,
    longActingEvening: activeSchedule.evening,
  });
  persistPanelOverrides();
}

function onSetUnsetClick(slot: SlotName): void {
  const refs = slotRefs[slot];
  if (activeSchedule[slot] !== null) {
    // Currently Active → Unset
    setSlot(slot, null);
    return;
  }
  // Currently Unset → validate and Set
  const schedule = readSlotSchedule(refs, slot);
  if (schedule === null) {
    shakeRow(refs);
    return;
  }
  setSlot(slot, schedule);
}

morningRefs.setBtn.addEventListener('click', () => onSetUnsetClick('morning'));
eveningRefs.setBtn.addEventListener('click', () => onSetUnsetClick('evening'));

/**
 * Re-hydrate the UI rows from a therapy snapshot (e.g. after btnLoad / btnImport / btnReset).
 * Updates the form input values, the cached activeSchedule, and the visual state.
 * Does NOT call bridge.setTherapyParam — the caller is expected to have already
 * pushed the new therapy state via bridge.reset(...).
 */
function syncSlotsFromTherapy(therapy: TherapyProfile): void {
  const apply = (slot: SlotName, schedule: LongActingSchedule | null): void => {
    const refs = slotRefs[slot];
    if (schedule !== null) {
      refs.type.value = schedule.type;
      refs.dose.value = String(schedule.units);
      refs.time.value = minutesToTimeString(schedule.injectionMinute);
    }
    activeSchedule[slot] = schedule;
    setSlotActiveState(refs, schedule);
  };
  apply('morning', therapy.longActingMorning);
  apply('evening', therapy.longActingEvening);
}

// ── Therapy changes ───────────────────────────────────────────────────────────

function onTherapyChange(): void {
  const mode = therapyMode.value as 'AID' | 'PUMP' | 'MDI';
  const modeLabel = mode === 'AID' ? 'AID mode' : mode === 'PUMP' ? 'Pump (open loop)' : 'MDI';
  scenarioModeLbl.textContent = modeLabel;
  scenarioModeMenu.querySelectorAll<HTMLElement>('li[role="option"]').forEach((li) => {
    li.setAttribute('aria-selected', li.dataset.value === mode ? 'true' : 'false');
  });
  bridge.setTherapyParam({
    mode,
    glucoseTarget: fromDisplay(parseFloat(glucoseTarget.value)),
    rapidAnalogue: rapidAnalogue.value as 'Fiasp' | 'Lispro' | 'Aspart',
    rapidDia:      parseFloat(progDIA.value),
    enableSMB:     enableSMB.checked,
  });
  sectionMDI.style.display       = mode === 'MDI'  ? 'block' : 'none';
  sectionBasal.style.display     = mode !== 'MDI'  ? 'block' : 'none';
  sectionTempBasal.style.display = mode !== 'MDI'  ? 'block' : 'none';
  rowSMB.style.display           = mode === 'AID'  ? 'flex'  : 'none';
  rowTarget.style.display        = mode === 'AID'  ? 'flex'  : 'none';
  rowOverlayBasal.style.display  = mode !== 'MDI'  ? 'flex'  : 'none';
  renderer.options.therapyMode   = mode;
  renderer.markDirty();
  // MDI-only submode chrome
  mdiSubmodeGroup.hidden = mode !== 'MDI';
  applyPrescriptionLockUI();
  persistPanelOverrides();
}

// ── MDI submode (LIVE / PRESCRIPTION) ────────────────────────────────────────

let currentSubmode: MDISubmode = 'LIVE';
// Restore last-saved prescription from localStorage (uiPrefs); falls back to defaults.
let currentPrescription: Prescription = JSON.parse(JSON.stringify(uiPrefs.prescription ?? DEFAULT_PRESCRIPTION));

function setSubmode(submode: MDISubmode, fromInit = false): void {
  currentSubmode = submode;
  for (const btn of mdiSubmodeGroup.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    const isActive = btn.dataset.submode === submode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  }
  // The "Edit prescription" button is only meaningful in PRESCRIPTION submode.
  btnEditPresc.hidden = submode !== 'PRESCRIPTION';
  bridge.setTherapyParam({ mdiSubmode: submode });
  applyPrescriptionLockUI();

  // Evening LA defaults to 21:00 in both submodes. The flip block remains as a
  // safety net: if the user manually entered 22:00 and toggles submode, normalise
  // back to 21:00. Init / restore skips this via fromInit.
  if (!fromInit && therapyMode.value === 'MDI' && activeSchedule.evening) {
    const cur = activeSchedule.evening.injectionMinute;
    const flipToPrescription = submode === 'PRESCRIPTION' && cur === 21 * 60;
    const flipToLive         = submode === 'LIVE'         && cur === 22 * 60;
    if (flipToPrescription || flipToLive) {
      const desired = 21 * 60;
      eveningRefs.time.value = minutesToTimeString(desired);
      setSlot('evening', { ...activeSchedule.evening, injectionMinute: desired });
    }
  }
}

/**
 * In PRESCRIPTION submode the user is forbidden from injecting boluses or meals
 * manually — the prescription is the single source of truth. Disable the
 * relevant controls; the bottom-strip quick-buttons get a visual "locked" hint.
 */
function applyPrescriptionLockUI(): void {
  const lock = therapyMode.value === 'MDI' && currentSubmode === 'PRESCRIPTION';
  const locks: HTMLButtonElement[] = [btnStripCarbs, btnStripBolus];
  for (const b of locks) {
    b.disabled = lock;
    b.title = lock ? 'Disabled in PRESCRIPTION submode' : '';
    b.style.opacity = lock ? '0.4' : '';
  }
  document.querySelectorAll<HTMLButtonElement>('.strip-dose-arrow').forEach((b) => {
    b.disabled = lock;
  });
}

mdiSubmodeGroup.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
  if (!btn || btn.classList.contains('active')) return;
  setSubmode(btn.dataset.submode as MDISubmode);
});

// ── Prescription modal ────────────────────────────────────────────────────────

let prescPreOpenRunning = false;

function openPrescriptionModal(): void {
  prescPreOpenRunning = appState.running;
  if (prescPreOpenRunning) { bridge.pause(); setRunning(false); }
  populatePrescriptionForm(currentPrescription);
  prescBackdrop.dataset.open = 'true';
}

function closePrescriptionModal(save: boolean): void {
  if (save) {
    currentPrescription = readPrescriptionForm();
    bridge.setTherapyParam({ prescription: currentPrescription });
    persistUIPrefs();
  }
  prescBackdrop.dataset.open = 'false';
  if (prescPreOpenRunning) { bridge.resume(); setRunning(true); }
  prescPreOpenRunning = false;
}

function populatePrescriptionForm(p: Prescription): void {
  prescFasting.checked = p.fasting;
  prescModal.dataset.fasting = String(p.fasting);
  prescFastingHelp.hidden = !p.fasting;

  prescMealsList.innerHTML = '';
  for (let i = 0; i < p.meals.length; i++) {
    const m = p.meals[i]!;
    const row = document.createElement('div');
    row.className = 'row';
    const hh = String(m.hour).padStart(2, '0');
    const mm = String(m.minute).padStart(2, '0');
    row.innerHTML = `
      <span class="lbl-time">${hh}:${mm}</span>
      <span class="lbl-grams">${m.grams} g — bolus 10 min before</span>
      <input type="number" min="0" max="30" step="0.5" value="${m.bolusUnits}" data-meal-idx="${i}" aria-label="Bolus units for ${hh}:${mm}" />
    `;
    prescMealsList.appendChild(row);
  }
  prescCorr1.value = String(p.correction.units1);
  prescCorr2.value = String(p.correction.units2);
  prescCorr3.value = String(p.correction.units3);
}

function readPrescriptionForm(): Prescription {
  const meals = currentPrescription.meals.map((m, i) => {
    const input = prescMealsList.querySelector<HTMLInputElement>(`input[data-meal-idx="${i}"]`);
    const v = input ? parseFloat(input.value) : 0;
    return { ...m, bolusUnits: isNaN(v) ? 0 : Math.max(0, v) };
  });
  const parseU = (el: HTMLInputElement) => {
    const v = parseFloat(el.value);
    return isNaN(v) ? 0 : Math.max(0, v);
  };
  return {
    fasting: prescFasting.checked,
    meals,
    correction: {
      units1: parseU(prescCorr1),
      units2: parseU(prescCorr2),
      units3: parseU(prescCorr3),
    },
    fastingCorrectionHours: currentPrescription.fastingCorrectionHours,
  };
}

prescFasting.addEventListener('change', () => {
  prescModal.dataset.fasting = String(prescFasting.checked);
  prescFastingHelp.hidden = !prescFasting.checked;
});
btnEditPresc.addEventListener('click',  () => openPrescriptionModal());
btnPrescClose.addEventListener('click', () => closePrescriptionModal(false));
btnPrescCancel.addEventListener('click', () => closePrescriptionModal(false));
btnPrescSave.addEventListener('click',   () => closePrescriptionModal(true));
prescBackdrop.addEventListener('click', (e) => {
  if (e.target === prescBackdrop) closePrescriptionModal(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && prescBackdrop.dataset.open === 'true') closePrescriptionModal(false);
});

[therapyMode, glucoseTarget, rapidAnalogue, progDIA].forEach(el =>
  el.addEventListener('change', onTherapyChange)
);
enableSMB.addEventListener('change', onTherapyChange);

// Scenario mode dropdown — custom listbox (Edge ignores native <option> padding)
function setScenarioMenuOpen(open: boolean): void {
  scenarioModeDD.setAttribute('data-open', String(open));
  scenarioModeBtn.setAttribute('aria-expanded', String(open));
  scenarioModeMenu.hidden = !open;
}
scenarioModeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setScenarioMenuOpen(!!scenarioModeMenu.hidden);
});
scenarioModeMenu.addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[role="option"]');
  if (!li) return;
  const value = li.dataset.value!;
  therapyMode.value = value;
  setScenarioMenuOpen(false);
  onTherapyChange();
});
document.addEventListener('click', (e) => {
  if (scenarioModeMenu.hidden) return;
  if (!scenarioModeDD.contains(e.target as Node)) setScenarioMenuOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !scenarioModeMenu.hidden) setScenarioMenuOpen(false);
});

// ── Temp basal ────────────────────────────────────────────────────────────────

btnSetTemp.addEventListener('click', () => {
  const r = parseFloat(tempBasalRate.value), d = parseFloat(tempBasalDur.value);
  const rSafe = isNaN(r) ? 0 : r;
  const dDisplay = isNaN(d) ? '∞' : `${d}`;
  bridge.setTempBasal(rSafe, isNaN(d) ? undefined : d);
  setStatus(`Temp basal: ${rSafe} U/hr for ${dDisplay} min`);
});
[tempBasalRate, tempBasalDur].forEach(el => el.addEventListener('change', persistPanelOverrides));
btnCancelTemp.addEventListener('click', () => { bridge.cancelTempBasal(); setStatus('Temp basal cancelled'); });

// ── Basal profile editor ──────────────────────────────────────────────────────

interface BasalSeg { timeMinutes: number; rateUPerHour: number; }
let basalSegments: BasalSeg[] = [{ timeMinutes: 0, rateUPerHour: 0.8 }];

function renderBasalRows(): void {
  basalProfileRows.innerHTML = '';
  basalSegments.forEach((seg, i) => {
    const row = document.createElement('div');
    row.className = 'bolus-row';
    row.style.marginBottom = '4px';
    row.innerHTML = `
      <input type="time" value="${minutesToTimeString(seg.timeMinutes)}"
        style="width:104px;background:var(--bg-surface);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:15.6px;"
        ${i === 0 ? 'disabled' : ''} />
      <input type="number" value="${seg.rateUPerHour}" min="0" max="5" step="0.05"
        style="flex:1;background:var(--bg-surface);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:15.6px;" />
      ${i > 0
        ? `<button style="padding:4px 8px;background:transparent;border:1px solid var(--red);color:var(--red);border-radius:6px;cursor:pointer;font-size:14.4px;">×</button>`
        : '<div style="width:32px;"></div>'}
    `;
    const [timeInput, rateInput] = Array.from(row.querySelectorAll('input')) as HTMLInputElement[];
    if (timeInput && !timeInput.disabled) {
      timeInput.addEventListener('change', () => {
        if (basalSegments[i]) basalSegments[i]!.timeMinutes = timeStringToMinutes(timeInput.value);
        pushBasalProfile();
      });
    }
    if (rateInput) {
      rateInput.addEventListener('change', () => {
        if (basalSegments[i]) basalSegments[i]!.rateUPerHour = parseFloat(rateInput.value) || 0;
        pushBasalProfile();
      });
    }
    const delBtn = row.querySelector('button');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        basalSegments.splice(i, 1);
        renderBasalRows();
        pushBasalProfile();
      });
    }
    basalProfileRows.appendChild(row);
  });
}

function pushBasalProfile(): void {
  bridge.setTherapyParam({
    basalProfile: [...basalSegments].sort((a, b) => a.timeMinutes - b.timeMinutes),
  });
  persistPanelOverrides();
}

btnAddBasal.addEventListener('click', () => {
  const last = basalSegments[basalSegments.length - 1]?.timeMinutes ?? 0;
  basalSegments.push({ timeMinutes: Math.min(last + 180, 23 * 60), rateUPerHour: 0.8 });
  renderBasalRows(); pushBasalProfile();
});

renderBasalRows();

// ── Patient changes ───────────────────────────────────────────────────────────

function onPatientChange(): void {
  bridge.setPatientParam({
    trueISF:             fromDisplay(parseFloat(trueISF.value)),
    trueCR:              parseFloat(trueCR.value),
    dia:                 parseFloat(trueDIA.value),
    weight:              parseFloat(patientWeight.value),
    diabetesDuration:    parseFloat(diabetesDuration.value),
    carbsAbsTime:        parseFloat(carbsAbsTime.value),
    gastricEmptyingRate: parseFloat(gastricRate.value),
  });
  persistPanelOverrides();
}

[trueISF, trueCR, trueDIA, patientWeight, diabetesDuration, carbsAbsTime, gastricRate]
  .forEach(el => el.addEventListener('change', onPatientChange));

// ── Overlay toggles ───────────────────────────────────────────────────────────

overlayBasal.addEventListener('change',  () => { renderer.options.showBasal = overlayBasal.checked; renderer.markDirty(); persistUIPrefs(); });
overlayIOB.addEventListener('change',    () => { renderer.options.showIOB = overlayIOB.checked; renderer.markDirty(); persistUIPrefs(); });
overlayCOB.addEventListener('change',    () => { renderer.options.showCOB = overlayCOB.checked; renderer.markDirty(); persistUIPrefs(); });
overlayEvents.addEventListener('change', () => { renderer.options.showEvents = overlayEvents.checked; renderer.markDirty(); persistUIPrefs(); });
overlayTrue.addEventListener('change',   () => { renderer.options.showTrueGlucose = overlayTrue.checked; renderer.markDirty(); persistUIPrefs(); });
overlayForecast.addEventListener('change', () => { renderer.options.showForecast = overlayForecast.checked; renderer.markDirty(); persistUIPrefs(); });
overlayBG.addEventListener('change',       () => { bgOverlay.style.display = overlayBG.checked ? '' : 'none'; persistUIPrefs(); });

// ── Session controls ──────────────────────────────────────────────────────────

btnExport.addEventListener('click', () => {
  const s = bridge.getCurrentState();
  s.cgmHistory = renderer.getHistorySnapshot();
  exportSession(s);
  setStatus('Saved session ✓');
});

btnImport.addEventListener('click', async () => {
  try {
    const { state, version } = await importSession();
    bridge.pause(); setRunning(false);
    bridge.reset(state);
    renderer.clearHistory();
    const history = state.cgmHistory ?? [];
    renderer.setHistorySnapshot(history);
    renderer.setEvents(state.events ?? []);
    syncSlotsFromTherapy(state.therapy);
    // Sync prescription state from loaded therapy (legacy sessions get defaults)
    currentPrescription = state.therapy.prescription
      ? JSON.parse(JSON.stringify(state.therapy.prescription))
      : JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION));
    setSubmode(state.therapy.mdiSubmode ?? 'LIVE', true);

    // Manually refresh the HUD from the loaded state, since no tick will fire while paused.
    const last = history[history.length - 1];
    const hudSnap: TickSnapshot = {
      type: 'TICK',
      simTimeMs: state.simTimeMs,
      cgm: last?.cgm ?? state.lastCGM,
      trueGlucose: last?.trueGlucose ?? state.trueGlucose,
      iob: last?.iob ?? 0,
      cob: last?.cob ?? 0,
      deltaMinutes: 5,
      trend: last?.trend ?? 0,
      basalRate: last?.basalRate ?? 0,
      longActingActivity: last?.longActingActivity ?? 0,
    };
    appState.lastSnap = hudSnap;
    updateHUD(hudSnap);
    renderer.snapToLive();
    renderer.markDirty();

    const legacy = version < 2 ? ' (legacy)' : '';
    setStatus(`Loaded at ${formatSimTime(state.simTimeMs)}${legacy}`);
  } catch (e) { setStatus(`Load failed: ${e}`); }
});

btnReset.addEventListener('click', () => {
  if (!confirm('Reset simulation? All current data will be lost.')) return;
  stopCompare();
  bridge.pause(); setRunning(false);
  const seed = (Date.now() ^ (Math.random() * 0xFFFF_FFFF) >>> 0) || 1;
  bridge.reset({
    simTimeMs:6*60*60_000, trueGlucose:100, lastCGM:100,
    patient:{weight:75,diabetesDuration:10,trueISF:40,trueCR:12,
             dia:6,carbsAbsTime:360,gastricEmptyingRate:1},
    therapy:{mode:'MDI',basalProfile:[{timeMinutes:0,rateUPerHour:0.8}],
             rapidAnalogue:'Fiasp',rapidDia:5,longActingMorning:null,longActingEvening:null,
             glucoseTarget:100,enableSMB:false,
             mdiSubmode:'LIVE',
             prescription: JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION))},
    g6State:{v:[0,0],cc:[0,0],tCalib:0,rng:{jsr:123456789^seed,seed}},
    activeBoluses:[],activeLongActing:[],
    resolvedMeals:[],pumpMicroBoluses:[],tempBasal:null,events:[],rngState:seed,
    lastMorningDay:-1,lastEveningDay:-1,prescriptionLastFiredDay:{},
    pidCGMHistory:[],pidPrevRate:0.8,pidTicksSinceLastMB:999,throttle:10,running:false,
  });
  setSlot('morning', null);
  setSlot('evening', null);
  renderer.clearHistory();
  setStatus('Simulation reset.');
});

// ── Comparison runs ───────────────────────────────────────────────────────────

btnSnapshot.addEventListener('click', () => {
  const s = bridge.getCurrentState();
  appState.snapshotState = s;
  btnRunCompare.disabled = false;
  setStatus(`Snapshot saved at ${formatSimTime(s.simTimeMs)}. Modify params, then press Run B.`);
});

btnRunCompare.addEventListener('click', () => {
  if (!appState.snapshotState) return;

  // Reset comparison sim from the snapshot, same G6 seed → identical noise
  compare.reset(appState.snapshotState);
  compare.setThrottle(appState.throttle);
  renderer.clearComparison();

  // Update legend labels
  renderer.options.primaryLabel = compareLabelA.value || 'Run A';
  renderer.options.compareLabel = compareLabelB.value || 'Run B';

  // Start both simulators from the same point
  // Primary (bridge) continues from wherever it is
  // Comparison starts from the snapshot
  if (appState.running) compare.resume();

  appState.compareRunning = true;
  btnRunCompare.style.display  = 'none';
  btnStopCompare.style.display = 'block';
  setStatus('Comparison running. Both traces shown.');
});

function stopCompare(): void {
  if (!appState.compareRunning) return;
  compare.pause();
  renderer.clearComparison();
  appState.compareRunning = false;
  appState.snapshotState  = null;
  btnRunCompare.disabled       = true;
  btnRunCompare.style.display  = 'block';
  btnStopCompare.style.display = 'none';
  setStatus('Comparison stopped.');
}

btnStopCompare.addEventListener('click', stopCompare);

// Label inputs update legend live
compareLabelA.addEventListener('input', () => { renderer.options.primaryLabel = compareLabelA.value; renderer.markDirty(); });
compareLabelB.addEventListener('input', () => { renderer.options.compareLabel = compareLabelB.value; renderer.markDirty(); });

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  switch (e.key) {
    case ' ': case 'p': e.preventDefault(); btnPause.click(); break;
    case 'ArrowRight': {
      const cur = appState.throttle;
      const next = THROTTLE_LADDER.find(v => v > cur * 1.001) ?? THROTTLE_LADDER[THROTTLE_LADDER.length - 1]!;
      throttleSlider.value = String(throttleToPos(next));
      throttleSlider.dispatchEvent(new Event('input')); break;
    }
    case 'ArrowLeft': {
      const cur = appState.throttle;
      const prev = [...THROTTLE_LADDER].reverse().find(v => v < cur * 0.999) ?? THROTTLE_LADDER[0]!;
      throttleSlider.value = String(throttleToPos(prev));
      throttleSlider.dispatchEvent(new Event('input')); break;
    }
    case 'm': bridge.meal(stripCarbsValue,  undefined, renderer.displayedSimTime); break;
    case 'b': bridge.bolus(stripBolusValue, undefined, renderer.displayedSimTime); break;
    case 'u': unitToggle.click(); break;
    case 'f': case 'F': toggleFullScreen(); break;
  }
});

// ── Onboarding case persistence + form application ───────────────────────────
const ONBOARDING_KEY = 'cgmsim.onboarded';
const CASE_KEY       = 'cgmsim.case';

interface SavedCase { caseId: CaseId; therapy: TherapyChoice; }

function loadSavedCase(): SavedCase | null {
  const raw = localStorage.getItem(CASE_KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<SavedCase>;
    if (!obj.caseId || !obj.therapy) return null;
    if (!(obj.caseId in PATIENT_CASES)) return null;
    return { caseId: obj.caseId, therapy: obj.therapy };
  } catch { return null; }
}

function writePatientToForm(p: VirtualPatient): void {
  const isMmol = appState.displayUnit === 'mmoll';
  trueISF.value          = isMmol ? (p.trueISF / 18.0182).toFixed(1) : String(p.trueISF);
  trueCR.value           = String(p.trueCR);
  trueDIA.value          = String(p.dia);
  patientWeight.value    = String(p.weight);
  diabetesDuration.value = String(p.diabetesDuration);
  carbsAbsTime.value     = String(p.carbsAbsTime);
  gastricRate.value      = String(p.gastricEmptyingRate);
}

function writeTherapyToForm(c: PatientCase, choice: TherapyChoice): void {
  const therapy = buildTherapyForCase(c, choice);
  therapyMode.value = therapy.mode;
  // Glucose target is stored canonical mg/dL, but the form may be displaying mmol/L.
  const isMmol = appState.displayUnit === 'mmoll';
  glucoseTarget.value = isMmol
    ? (therapy.glucoseTarget / 18.0182).toFixed(1)
    : String(Math.round(therapy.glucoseTarget));
  basalSegments = therapy.basalProfile.map(e => ({ ...e }));
  renderBasalRows();
  setSlot('morning', null);
  setSlot('evening', null);
  if (therapy.mode === 'MDI' && therapy.longActingEvening) {
    eveningRefs.type.value = therapy.longActingEvening.type;
    eveningRefs.dose.value = String(therapy.longActingEvening.units);
    eveningRefs.time.value = minutesToTimeString(therapy.longActingEvening.injectionMinute);
    setSlot('evening', therapy.longActingEvening);
  }
}

getEl<HTMLButtonElement>('btn-reopen-onboarding').addEventListener('click', async () => {
  const result = await runOnboarding();
  if (!result.caseId || !result.therapy) return;
  const c = PATIENT_CASES[result.caseId];

  // Wipe the running simulation so the new case starts cleanly — matches
  // Session > Reset simulation, but uses the chosen case's params instead
  // of the hardcoded defaults.
  stopCompare();
  bridge.pause(); setRunning(false);
  const seed = (Date.now() ^ (Math.random() * 0xFFFF_FFFF) >>> 0) || 1;
  bridge.reset({
    simTimeMs: 6*60*60_000, trueGlucose: 100, lastCGM: 100,
    patient: { ...c.patient },
    therapy: buildTherapyForCase(c, result.therapy),
    g6State: { v:[0,0], cc:[0,0], tCalib:0, rng:{ jsr:123456789^seed, seed } },
    activeBoluses: [], activeLongActing: [],
    resolvedMeals: [], pumpMicroBoluses: [], tempBasal: null, events: [], rngState: seed,
    lastMorningDay: -1, lastEveningDay: -1, prescriptionLastFiredDay: {},
    pidCGMHistory: [], pidPrevRate: 0.8, pidTicksSinceLastMB: 999, throttle: 10, running: false,
  });
  renderer.clearHistory();

  suppressPersist = true;
  clearPanelOverrides();
  writePatientToForm(c.patient);
  writeTherapyToForm(c, result.therapy);
  onTherapyChange();
  onPatientChange();
  pushBasalProfile();
  suppressPersist = false;
  localStorage.setItem(CASE_KEY, JSON.stringify({ caseId: result.caseId, therapy: result.therapy }));
  document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="therapy"]')?.click();
  setStatus(`Loaded case: ${c.shortLabel} · ${result.therapy.toUpperCase()}`);
});

getEl<HTMLButtonElement>('btn-reset-defaults').addEventListener('click', () => {
  const sc = loadSavedCase();
  if (!sc) {
    setStatus('No saved case — use ↻ Restart onboarding.');
    return;
  }
  if (!window.confirm('Discard all panel edits and reset to case defaults?')) return;
  const c = PATIENT_CASES[sc.caseId];
  suppressPersist = true;
  clearPanelOverrides();
  writePatientToForm(c.patient);
  writeTherapyToForm(c, sc.therapy);
  onTherapyChange();
  onPatientChange();
  pushBasalProfile();
  suppressPersist = false;
  setStatus(`Reset to case defaults: ${c.shortLabel} · ${sc.therapy.toUpperCase()}`);
});

// ── Initial state (gated on onboarding modal on first launch) ────────────────

// HTML default input values are written in mg/dL (e.g. glucose-target=100, true-isf=40).
// syncPanelUnits MUST run before the change handlers, otherwise fromDisplay() treats
// "40" as mmol/L → 720 mg/dL/U and EGP rockets BG to ceiling.
// At this point appState.displayUnit reflects the loaded UI pref (default mmol/L).

void (async () => {
  syncPanelUnits('mgdl');

  const onboarded = localStorage.getItem(ONBOARDING_KEY) === 'true';
  let savedCase = loadSavedCase();
  let justOnboarded = false;

  if (!onboarded) {
    ensureOnboardingStyles();
    const result = await runOnboarding();
    localStorage.setItem(ONBOARDING_KEY, 'true');
    if (result.caseId && result.therapy) {
      savedCase = { caseId: result.caseId, therapy: result.therapy };
      localStorage.setItem(CASE_KEY, JSON.stringify(savedCase));
      justOnboarded = true;
    }
  }

  if (savedCase) {
    const c = PATIENT_CASES[savedCase.caseId];
    writePatientToForm(c.patient);
    writeTherapyToForm(c, savedCase.therapy);
  }

  // First-time onboarding wipes any stale overrides; otherwise apply the
  // user's saved panel edits on top of the case template.
  if (justOnboarded) {
    clearPanelOverrides();
  } else {
    const overrides = loadPanelOverrides();
    if (overrides) applyPanelSnapshot(overrides);
  }

  onTherapyChange();
  // Push the persisted prescription into the simulator so it matches the UI's
  // `currentPrescription` (loaded from localStorage). Without this, the engine
  // would silently run on DEFAULT_PRESCRIPTION until the user reopens the modal.
  bridge.setTherapyParam({ prescription: currentPrescription });
  setSubmode(currentSubmode, true);
  onPatientChange();
  pushBasalProfile();
  bridge.setThrottle(10);
  setRunning(false);

  // ── Apply persisted UI prefs ──
  renderer.options.showIOB         = uiPrefs.showIOB;
  renderer.options.showCOB         = uiPrefs.showCOB;
  renderer.options.showBasal       = uiPrefs.showBasal;
  renderer.options.showEvents      = uiPrefs.showEvents;
  renderer.options.showTrueGlucose = uiPrefs.showTrueGlucose;
  renderer.options.showForecast    = uiPrefs.showForecast;
  renderer.options.displayUnit     = uiPrefs.displayUnit;
  overlayIOB.checked      = uiPrefs.showIOB;
  overlayCOB.checked      = uiPrefs.showCOB;
  overlayBasal.checked    = uiPrefs.showBasal;
  overlayEvents.checked   = uiPrefs.showEvents;
  overlayTrue.checked     = uiPrefs.showTrueGlucose;
  overlayForecast.checked = uiPrefs.showForecast;
  overlayBG.checked       = uiPrefs.showBgOverlay;
  bgOverlay.style.display = uiPrefs.showBgOverlay ? '' : 'none';
  unitToggle.textContent  = uiPrefs.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  sidePanel.classList.toggle('open', uiPrefs.panelOpen);
  btnPanel.classList.toggle('active', uiPrefs.panelOpen);
  renderer.setZoom(uiPrefs.viewWindowMinutes);
  updateZoomButtons(uiPrefs.viewWindowMinutes);
  renderer.markDirty();

  if (justOnboarded) {
    appState.panelOpen = true;
    sidePanel.classList.add('open');
    btnPanel.classList.add('active');
    document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="therapy"]')?.click();
    persistUIPrefs();
  }

  // Init complete — user gestures from now on persist panel overrides.
  suppressPersist = false;
})();

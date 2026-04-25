/**
 * CGMSIM v4 — Main UI entry point (Phase 3)
 * Adds: comparison runs, full-screen mode, diabetes duration control
 */

import type { TickSnapshot, DisplayUnit, WorkerState } from '@cgmsim/shared';
import { InlineSimulator } from './inline-simulator.js';
import { CGMRenderer } from './canvas-renderer.js';
import { saveState, loadState, exportSession, importSession } from './storage.js';

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

const THROTTLE_STOPS = [0.25, 0.5, 1, 5, 10, 50, 100, 600, 3600] as const;
type ThrottleStop = typeof THROTTLE_STOPS[number];

function sliderToThrottle(v: number): ThrottleStop {
  return THROTTLE_STOPS[Math.min(v, THROTTLE_STOPS.length - 1)] ?? 10;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function trendArrow(mgdlPerMin: number): string {
  if (mgdlPerMin >  3)   return '↑↑';
  if (mgdlPerMin >  1)   return '↑';
  if (mgdlPerMin >  0.3) return '↗';
  if (mgdlPerMin < -3)   return '↓↓';
  if (mgdlPerMin < -1)   return '↓';
  if (mgdlPerMin < -0.3) return '↘';
  return '→';
}

function formatSimTime(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const s = m % 60;
  return `D+${String(d).padStart(2,'0')}:${String(h).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 22) * 60 + (m ?? 0);
}

function minutesToTimeString(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}

// ── App state ─────────────────────────────────────────────────────────────────

const appState = {
  running:        false,
  throttle:       10 as ThrottleStop,
  displayUnit:    'mmoll' as DisplayUnit,
  panelOpen:      false,
  fullScreen:     false,
  lastSnap:       null as TickSnapshot | null,
  snapshotState:  null as WorkerState | null,   // saved for comparison run
  compareRunning: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

const canvas           = getEl<HTMLCanvasElement>('cgm-canvas');
const btnPause         = getEl<HTMLButtonElement>('btn-pause');
const throttleSlider   = getEl<HTMLInputElement>('throttle-slider');
const throttleVal      = getEl<HTMLElement>('throttle-val');
const simTimeEl        = getEl<HTMLElement>('sim-time');
const currentCGMEl     = getEl<HTMLElement>('current-cgm');
const cgmUnitEl        = getEl<HTMLElement>('cgm-unit');
const trendArrowEl     = getEl<HTMLElement>('trend-arrow');
const iobVal           = getEl<HTMLElement>('iob-val');
const cobVal           = getEl<HTMLElement>('cob-val');
const unitToggle       = getEl<HTMLButtonElement>('unit-toggle');
const btnPanel         = getEl<HTMLButtonElement>('btn-panel');
const btnFullscreen    = getEl<HTMLButtonElement>('btn-fullscreen');
const sidePanel        = getEl<HTMLElement>('side-panel');
const btnBolus         = getEl<HTMLButtonElement>('btn-bolus');
const btnMeal          = getEl<HTMLButtonElement>('btn-meal');
const btnQuickMeal     = getEl<HTMLButtonElement>('btn-quick-meal');
const btnQuickBolus    = getEl<HTMLButtonElement>('btn-quick-bolus');
const bolusAmount      = getEl<HTMLInputElement>('bolus-amount');
const mealCarbs        = getEl<HTMLInputElement>('meal-carbs');
const therapyMode      = getEl<HTMLSelectElement>('therapy-mode');
const glucoseTarget    = getEl<HTMLInputElement>('glucose-target');
const rapidAnalogue    = getEl<HTMLSelectElement>('rapid-analogue');
const progISF          = getEl<HTMLInputElement>('prog-isf');
const progCR           = getEl<HTMLInputElement>('prog-cr');
const longActingType   = getEl<HTMLSelectElement>('long-acting-type');
const longActingDose   = getEl<HTMLInputElement>('long-acting-dose');
const longActingTime   = getEl<HTMLInputElement>('long-acting-time');
const tempBasalRate    = getEl<HTMLInputElement>('temp-basal-rate');
const tempBasalDur     = getEl<HTMLInputElement>('temp-basal-duration');
const btnSetTemp       = getEl<HTMLButtonElement>('btn-set-temp');
const btnCancelTemp    = getEl<HTMLButtonElement>('btn-cancel-temp');
const trueISF          = getEl<HTMLInputElement>('true-isf');
const trueCR           = getEl<HTMLInputElement>('true-cr');
const patientWeight    = getEl<HTMLInputElement>('patient-weight');
const diabetesDuration = getEl<HTMLInputElement>('diabetes-duration');
const egpAmp           = getEl<HTMLInputElement>('egp-amp');
const egpPeak          = getEl<HTMLInputElement>('egp-peak');
const egpBasal         = getEl<HTMLInputElement>('egp-basal');
const carbsAbsTime     = getEl<HTMLInputElement>('carbs-abs-time');
const gastricRate      = getEl<HTMLInputElement>('gastric-rate');
const enableSMB        = getEl<HTMLInputElement>('enable-smb');
const rowSMB           = getEl<HTMLElement>('row-smb');
const overlayBasal     = getEl<HTMLInputElement>('overlay-basal');
const overlayIOB       = getEl<HTMLInputElement>('overlay-iob');
const overlayCOB       = getEl<HTMLInputElement>('overlay-cob');
const overlayEvents    = getEl<HTMLInputElement>('overlay-events');
const overlayTrue      = getEl<HTMLInputElement>('overlay-true');
const btnSave          = getEl<HTMLButtonElement>('btn-save');
const btnLoad          = getEl<HTMLButtonElement>('btn-load');
const btnExport        = getEl<HTMLButtonElement>('btn-export');
const btnImport        = getEl<HTMLButtonElement>('btn-import');
const btnReset         = getEl<HTMLButtonElement>('btn-reset');
const btnZoom3h        = getEl<HTMLButtonElement>('btn-zoom-3h');
const btnZoom6h        = getEl<HTMLButtonElement>('btn-zoom-6h');
const btnZoom12h       = getEl<HTMLButtonElement>('btn-zoom-12h');
const btnZoom24h       = getEl<HTMLButtonElement>('btn-zoom-24h');
const btnLive          = getEl<HTMLButtonElement>('btn-live');
const scenarioBadge    = getEl<HTMLElement>('scenario-badge');
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

// ── Simulators ────────────────────────────────────────────────────────────────

const bridge   = new InlineSimulator();   // primary
const compare  = new InlineSimulator();   // comparison (idle until activated)
const renderer = new CGMRenderer(canvas);
renderer.start();

// ── Tick handlers ─────────────────────────────────────────────────────────────

let tickCount = 0;

bridge.onTick((snap) => {
  appState.lastSnap = snap;
  renderer.pushTick(snap);
  updateHUD(snap);
  // Auto-save every 10 ticks
  if (++tickCount % 10 === 0) bridge.requestSave();
});

bridge.onEvent((evs) => renderer.pushEvents(evs));

bridge.onStateSaved(async (s) => {
  try { await saveState(s); setStatus(`Auto-saved at ${formatSimTime(s.simTimeMs)}`); }
  catch { /* IndexedDB unavailable in some contexts */ }
});

compare.onTick((snap) => {
  renderer.pushComparisonTick(snap);
});

// ── HUD ───────────────────────────────────────────────────────────────────────

function updateHUD(snap: TickSnapshot): void {
  simTimeEl.textContent = formatSimTime(snap.simTimeMs);
  const disp = appState.displayUnit === 'mmoll'
    ? (snap.cgm / 18.0182).toFixed(1) : String(Math.round(snap.cgm));
  currentCGMEl.textContent = disp;
  currentCGMEl.className = snap.cgm < 54 ? 'hypo-l2' : snap.cgm < 70 ? 'hypo-l1' : '';
  trendArrowEl.textContent = trendArrow(snap.trend);
  iobVal.textContent = snap.iob.toFixed(2);
  cobVal.textContent = snap.cob.toFixed(0);
}

function setStatus(msg: string): void { sessionStatus.textContent = msg; }

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

throttleSlider.addEventListener('input', () => {
  const t = sliderToThrottle(parseInt(throttleSlider.value));
  appState.throttle = t;
  throttleVal.textContent = `×${t}`;
  bridge.setThrottle(t);
  if (appState.compareRunning) compare.setThrottle(t);
  renderer.setPlayback(t, appState.running);
});
throttleVal.textContent = `×${sliderToThrottle(parseInt(throttleSlider.value))}`;

// ── Zoom and pan controls ─────────────────────────────────────────────────────

function updateZoomButtons(activeMinutes: number): void {
  btnZoom3h.classList.toggle('active',  activeMinutes === 180);
  btnZoom6h.classList.toggle('active',  activeMinutes === 360);
  btnZoom12h.classList.toggle('active', activeMinutes === 720);
  btnZoom24h.classList.toggle('active', activeMinutes === 1440);
}

btnZoom3h.addEventListener('click',  () => { renderer.setZoom(180);  updateZoomButtons(180); });
btnZoom6h.addEventListener('click',  () => { renderer.setZoom(360);  updateZoomButtons(360); });
btnZoom12h.addEventListener('click', () => { renderer.setZoom(720);  updateZoomButtons(720); });
btnZoom24h.addEventListener('click', () => { renderer.setZoom(1440); updateZoomButtons(1440); });
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

  // ISF fields (both programmed and true)
  for (const input of [progISF, trueISF]) {
    const v = parseFloat(input.value);
    if (!isNaN(v)) input.value = fmt(conv(v));
    input.min  = isMmol ? '0.5'  : '10';
    input.max  = isMmol ? '11.1' : '200';
    input.step = isMmol ? '0.1'  : '5';
  }
  document.getElementById('unit-prog-isf')!.textContent  = isMmol ? 'mmol/L/U' : 'mg/dL/U';
  document.getElementById('unit-true-isf')!.textContent  = isMmol ? 'mmol/L/U' : 'mg/dL/U';
}

unitToggle.addEventListener('click', () => {
  const prev = appState.displayUnit;
  appState.displayUnit = prev === 'mgdl' ? 'mmoll' : 'mgdl';
  renderer.options.displayUnit = appState.displayUnit;
  unitToggle.textContent = appState.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  cgmUnitEl.textContent  = appState.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  syncPanelUnits(prev);
  if (appState.lastSnap) updateHUD(appState.lastSnap);
  renderer.markDirty();
});

// ── Panel and tabs ────────────────────────────────────────────────────────────

btnPanel.addEventListener('click', () => {
  appState.panelOpen = !appState.panelOpen;
  sidePanel.classList.toggle('open', appState.panelOpen);
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
    appState.panelOpen = false;
  }
  btnFullscreen.textContent = appState.fullScreen ? '⊡' : '⛶';
  renderer.markDirty();
});

btnFullscreen.addEventListener('click', toggleFullScreen);

// ── Quick inject ──────────────────────────────────────────────────────────────

btnQuickMeal.addEventListener('click',  () => bridge.meal(60));
btnQuickBolus.addEventListener('click', () => bridge.bolus(parseFloat(bolusAmount.value) || 4));
btnBolus.addEventListener('click', () => {
  const u = parseFloat(bolusAmount.value); if (u > 0) bridge.bolus(u);
});
btnMeal.addEventListener('click', () => {
  const c = parseFloat(mealCarbs.value); if (c > 0) bridge.meal(c);
});

// ── Therapy changes ───────────────────────────────────────────────────────────

function onTherapyChange(): void {
  const mode = therapyMode.value as 'AID' | 'PUMP' | 'MDI';
  const modeLabel = mode === 'AID' ? 'AID mode' : mode === 'PUMP' ? 'Pump (open loop)' : 'MDI';
  scenarioBadge.textContent = `Default patient · ${modeLabel}`;
  bridge.setTherapyParam({
    mode,
    glucoseTarget:           fromDisplay(parseFloat(glucoseTarget.value)),
    rapidAnalogue:           rapidAnalogue.value as 'Fiasp' | 'Lispro' | 'Aspart',
    programmedISF:           fromDisplay(parseFloat(progISF.value)),
    programmedCR:            parseFloat(progCR.value),
    longActingType:          longActingType.value as 'Glargine' | 'Degludec' | 'Detemir',
    longActingDose:          parseFloat(longActingDose.value),
    longActingInjectionTime: timeStringToMinutes(longActingTime.value),
    enableSMB:               enableSMB.checked,
  });
  sectionMDI.style.display   = mode === 'MDI'  ? 'block' : 'none';
  sectionBasal.style.display = mode !== 'MDI'  ? 'block' : 'none';
  rowSMB.style.display       = mode === 'AID'  ? 'flex'  : 'none';
}

[therapyMode, glucoseTarget, rapidAnalogue, progISF, progCR,
 longActingType, longActingDose, longActingTime].forEach(el =>
  el.addEventListener('change', onTherapyChange)
);
enableSMB.addEventListener('change', onTherapyChange);

// ── Temp basal ────────────────────────────────────────────────────────────────

btnSetTemp.addEventListener('click', () => {
  const r = parseFloat(tempBasalRate.value), d = parseFloat(tempBasalDur.value);
  bridge.setTempBasal(isNaN(r) ? 0 : r, isNaN(d) ? undefined : d);
  setStatus(`Temp basal: ${r} U/hr for ${d} min`);
});
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
        style="width:80px;background:var(--bg-surface);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:13px;"
        ${i === 0 ? 'disabled' : ''} />
      <input type="number" value="${seg.rateUPerHour}" min="0" max="5" step="0.05"
        style="flex:1;background:var(--bg-surface);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:13px;" />
      ${i > 0
        ? `<button style="padding:4px 8px;background:transparent;border:1px solid var(--red);color:var(--red);border-radius:6px;cursor:pointer;font-size:12px;">×</button>`
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
    weight:              parseFloat(patientWeight.value),
    diabetesDuration:    parseFloat(diabetesDuration.value),
    egpAmplitude:        parseFloat(egpAmp.value),
    egpPeakHour:         parseFloat(egpPeak.value),
    egpBasalLevel:       parseFloat(egpBasal.value),
    carbsAbsTime:        parseFloat(carbsAbsTime.value),
    gastricEmptyingRate: parseFloat(gastricRate.value),
  });
}

[trueISF, trueCR, patientWeight, diabetesDuration,
 egpAmp, egpPeak, egpBasal, carbsAbsTime, gastricRate]
  .forEach(el => el.addEventListener('change', onPatientChange));

// ── Overlay toggles ───────────────────────────────────────────────────────────

overlayBasal.addEventListener('change',  () => { renderer.options.showBasal = overlayBasal.checked; renderer.markDirty(); });
overlayIOB.addEventListener('change',    () => { renderer.options.showIOB = overlayIOB.checked; renderer.markDirty(); });
overlayCOB.addEventListener('change',    () => { renderer.options.showCOB = overlayCOB.checked; renderer.markDirty(); });
overlayEvents.addEventListener('change', () => { renderer.options.showEvents = overlayEvents.checked; renderer.markDirty(); });
overlayTrue.addEventListener('change',   () => { renderer.options.showTrueGlucose = overlayTrue.checked; renderer.markDirty(); });

// ── Session controls ──────────────────────────────────────────────────────────

btnSave.addEventListener('click', () => { bridge.requestSave(); setStatus('Saved ✓'); });

btnLoad.addEventListener('click', async () => {
  try {
    const s = await loadState();
    if (!s) { setStatus('No saved session found.'); return; }
    bridge.pause(); setRunning(false);
    bridge.reset(s); renderer.clearHistory();
    setStatus(`Loaded at ${formatSimTime(s.simTimeMs)}`);
  } catch (e) { setStatus(`Load failed: ${e}`); }
});

btnExport.addEventListener('click', () => {
  bridge.requestSave();
  const once = (s: WorkerState) => { exportSession(s); bridge.onStateSaved(() => {}); };
  bridge.onStateSaved(once);
  setStatus('Exporting...');
});

btnImport.addEventListener('click', async () => {
  try {
    const s = await importSession();
    bridge.pause(); setRunning(false);
    bridge.reset(s); renderer.clearHistory();
    setStatus(`Imported at ${formatSimTime(s.simTimeMs)}`);
  } catch (e) { setStatus(`Import failed: ${e}`); }
});

btnReset.addEventListener('click', () => {
  if (!confirm('Reset simulation? All current data will be lost.')) return;
  stopCompare();
  bridge.pause(); setRunning(false);
  bridge.reset({
    simTimeMs:0, trueGlucose:100, lastCGM:100,
    patient:{weight:75,age:35,gender:'Male',diabetesDuration:10,trueISF:40,trueCR:12,
             dia:6,tp:75,carbsAbsTime:360,egpBasalLevel:0.04,egpAmplitude:1,egpPeakHour:5,gastricEmptyingRate:1},
    therapy:{mode:'PUMP',programmedISF:40,programmedCR:12,basalProfile:[{timeMinutes:0,rateUPerHour:0.8}],
             rapidAnalogue:'Fiasp',rapidDia:5,longActingType:'Glargine',longActingDose:20,
             longActingInjectionTime:22*60,glucoseTarget:100,correctionThreshold:120,enableSMB:false},
    g6State:{v:[0,0],cc:[0,0],tCalib:0,rng:(()=>{const s=(Date.now()^(Math.random()*0xFFFF_FFFF)>>>0)||1;return{jsr:123456789^s,seed:s};})()},
    activeBoluses:[],activeMeals:[],activeLongActing:[],
    pidCGMHistory:[],pidPrevRate:0.8,pidTicksSinceLastMB:999,throttle:10,running:false,
  });
  renderer.clearHistory();
  setStatus('Simulation reset.');
});

// ── Comparison runs ───────────────────────────────────────────────────────────

btnSnapshot.addEventListener('click', () => {
  bridge.requestSave();
  const once = (s: WorkerState) => {
    appState.snapshotState = s;
    btnRunCompare.disabled = false;
    setStatus(`Snapshot saved at ${formatSimTime(s.simTimeMs)}. Modify params, then press Run B.`);
  };
  bridge.onStateSaved(once);
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
      const v = Math.min(parseInt(throttleSlider.value) + 1, THROTTLE_STOPS.length - 1);
      throttleSlider.value = String(v);
      throttleSlider.dispatchEvent(new Event('input')); break;
    }
    case 'ArrowLeft': {
      const v = Math.max(parseInt(throttleSlider.value) - 1, 0);
      throttleSlider.value = String(v);
      throttleSlider.dispatchEvent(new Event('input')); break;
    }
    case 'm': bridge.meal(60); break;
    case 'b': bridge.bolus(parseFloat(bolusAmount.value) || 4); break;
    case 'u': unitToggle.click(); break;
    case 'f': case 'F': toggleFullScreen(); break;
  }
});

// ── Initial state ─────────────────────────────────────────────────────────────

onTherapyChange();  // set MDI/pump section visibility + initial badge
syncPanelUnits('mgdl');  // convert panel inputs and labels to mmol/L on load
bridge.setThrottle(10);
setRunning(false);  // start paused — user presses ▶ to begin

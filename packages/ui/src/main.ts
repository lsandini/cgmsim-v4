/**
 * CGMSIM v4 — Main UI entry point (Phase 2)
 */

import type { TickSnapshot, DisplayUnit } from '@cgmsim/shared';
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

// ── Throttle map ──────────────────────────────────────────────────────────────

const THROTTLE_STOPS = [0.25, 0.5, 1, 5, 10, 50, 100] as const;
type ThrottleStop = typeof THROTTLE_STOPS[number];

function sliderToThrottle(v: number): ThrottleStop {
  return THROTTLE_STOPS[Math.min(v, THROTTLE_STOPS.length - 1)] ?? 10;
}

// ── Trend arrow ───────────────────────────────────────────────────────────────

function trendArrow(mgdlPerMin: number): string {
  if (mgdlPerMin >  3)   return '↑↑';
  if (mgdlPerMin >  1)   return '↑';
  if (mgdlPerMin >  0.3) return '↗';
  if (mgdlPerMin < -3)   return '↓↓';
  if (mgdlPerMin < -1)   return '↓';
  if (mgdlPerMin < -0.3) return '↘';
  return '→';
}

// ── Sim time formatter ────────────────────────────────────────────────────────

function formatSimTime(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return `D+${String(d).padStart(2,'0')}:${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── App state ─────────────────────────────────────────────────────────────────

const state = {
  running:     false,
  throttle:    10 as ThrottleStop,
  displayUnit: 'mgdl' as DisplayUnit,
  panelOpen:   false,
  lastSnap:    null as TickSnapshot | null,
  autoSaveTimer: 0,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

const canvas          = getEl<HTMLCanvasElement>('cgm-canvas');
const btnPause        = getEl<HTMLButtonElement>('btn-pause');
const throttleSlider  = getEl<HTMLInputElement>('throttle-slider');
const throttleVal     = getEl<HTMLElement>('throttle-val');
const simTimeEl       = getEl<HTMLElement>('sim-time');
const currentCGMEl    = getEl<HTMLElement>('current-cgm');
const cgmUnitEl       = getEl<HTMLElement>('cgm-unit');
const trendArrowEl    = getEl<HTMLElement>('trend-arrow');
const iobVal          = getEl<HTMLElement>('iob-val');
const cobVal          = getEl<HTMLElement>('cob-val');
const unitToggle      = getEl<HTMLButtonElement>('unit-toggle');
const btnPanel        = getEl<HTMLButtonElement>('btn-panel');
const sidePanel       = getEl<HTMLElement>('side-panel');
const btnBolus        = getEl<HTMLButtonElement>('btn-bolus');
const btnMeal         = getEl<HTMLButtonElement>('btn-meal');
const btnQuickMeal    = getEl<HTMLButtonElement>('btn-quick-meal');
const btnQuickBolus   = getEl<HTMLButtonElement>('btn-quick-bolus');
const bolusAmount     = getEl<HTMLInputElement>('bolus-amount');
const mealCarbs       = getEl<HTMLInputElement>('meal-carbs');
const therapyMode     = getEl<HTMLSelectElement>('therapy-mode');
const glucoseTarget   = getEl<HTMLInputElement>('glucose-target');
const rapidAnalogue   = getEl<HTMLSelectElement>('rapid-analogue');
const progISF         = getEl<HTMLInputElement>('prog-isf');
const progCR          = getEl<HTMLInputElement>('prog-cr');
const longActingType  = getEl<HTMLSelectElement>('long-acting-type');
const longActingDose  = getEl<HTMLInputElement>('long-acting-dose');
const longActingTime  = getEl<HTMLInputElement>('long-acting-time');
const tempBasalRate   = getEl<HTMLInputElement>('temp-basal-rate');
const tempBasalDur    = getEl<HTMLInputElement>('temp-basal-duration');
const btnSetTemp      = getEl<HTMLButtonElement>('btn-set-temp');
const btnCancelTemp   = getEl<HTMLButtonElement>('btn-cancel-temp');
const trueISF         = getEl<HTMLInputElement>('true-isf');
const trueCR          = getEl<HTMLInputElement>('true-cr');
const patientWeight   = getEl<HTMLInputElement>('patient-weight');
const egpAmp          = getEl<HTMLInputElement>('egp-amp');
const egpPeak         = getEl<HTMLInputElement>('egp-peak');
const egpBasal        = getEl<HTMLInputElement>('egp-basal');
const carbsAbsTime    = getEl<HTMLInputElement>('carbs-abs-time');
const gastricRate     = getEl<HTMLInputElement>('gastric-rate');
const overlayIOB      = getEl<HTMLInputElement>('overlay-iob');
const overlayCOB      = getEl<HTMLInputElement>('overlay-cob');
const overlayEvents   = getEl<HTMLInputElement>('overlay-events');
const overlayTrue     = getEl<HTMLInputElement>('overlay-true');
const btnSave         = getEl<HTMLButtonElement>('btn-save');
const btnLoad         = getEl<HTMLButtonElement>('btn-load');
const btnExport       = getEl<HTMLButtonElement>('btn-export');
const btnImport       = getEl<HTMLButtonElement>('btn-import');
const btnReset        = getEl<HTMLButtonElement>('btn-reset');
const sessionStatus   = getEl<HTMLElement>('session-status');
const basalProfileRows = getEl<HTMLElement>('basal-profile-rows');
const btnAddBasal     = getEl<HTMLButtonElement>('btn-add-basal');
const sectionMDI      = getEl<HTMLElement>('section-mdi');
const sectionBasal    = getEl<HTMLElement>('section-basal');

// ── Initialise ────────────────────────────────────────────────────────────────

const bridge   = new InlineSimulator();
const renderer = new CGMRenderer(canvas);
renderer.start();

bridge.onTick((snap) => {
  state.lastSnap = snap;
  renderer.pushTick(snap);
  updateHUD(snap);
});

bridge.onEvent((evs) => {
  renderer.pushEvents(evs);
});

// Auto-save every 10 simulated minutes (= 10 ticks at any speed)
let tickCount = 0;
bridge.onTick(() => {
  tickCount++;
  if (tickCount % 10 === 0) {
    bridge.requestSave();
  }
});

bridge.onStateSaved(async (s) => {
  try {
    await saveState(s);
    setStatus(`Auto-saved at ${formatSimTime(s.simTimeMs)}`);
  } catch {
    // IndexedDB not available (e.g. standalone file) — silently skip
  }
});

// ── HUD update ────────────────────────────────────────────────────────────────

function updateHUD(snap: TickSnapshot): void {
  simTimeEl.textContent = formatSimTime(snap.simTimeMs);
  const cgmDisplay = state.displayUnit === 'mmoll'
    ? (snap.cgm / 18.0182).toFixed(1)
    : String(Math.round(snap.cgm));
  currentCGMEl.textContent = cgmDisplay;
  currentCGMEl.className = snap.cgm < 54 ? 'hypo-l2' : snap.cgm < 70 ? 'hypo-l1' : '';
  trendArrowEl.textContent = trendArrow(snap.trend);
  iobVal.textContent = snap.iob.toFixed(2);
  cobVal.textContent = snap.cob.toFixed(0);
}

function setStatus(msg: string): void {
  sessionStatus.textContent = msg;
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

function setRunning(running: boolean): void {
  state.running = running;
  btnPause.textContent = running ? '⏸' : '▶';
  btnPause.classList.toggle('running', running);
}

btnPause.addEventListener('click', () => {
  if (state.running) { bridge.pause(); setRunning(false); }
  else               { bridge.resume(); setRunning(true); }
});

// ── Throttle ──────────────────────────────────────────────────────────────────

throttleSlider.addEventListener('input', () => {
  const t = sliderToThrottle(parseInt(throttleSlider.value));
  state.throttle = t;
  throttleVal.textContent = `×${t}`;
  bridge.setThrottle(t);
});
throttleVal.textContent = `×${sliderToThrottle(parseInt(throttleSlider.value))}`;

// ── Unit toggle ───────────────────────────────────────────────────────────────

unitToggle.addEventListener('click', () => {
  state.displayUnit = state.displayUnit === 'mgdl' ? 'mmoll' : 'mgdl';
  renderer.options.displayUnit = state.displayUnit;
  unitToggle.textContent = state.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  cgmUnitEl.textContent  = state.displayUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
  if (state.lastSnap) updateHUD(state.lastSnap);
  renderer.markDirty();
});

// ── Panel and tabs ────────────────────────────────────────────────────────────

btnPanel.addEventListener('click', () => {
  state.panelOpen = !state.panelOpen;
  sidePanel.classList.toggle('open', state.panelOpen);
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

// ── Quick inject ──────────────────────────────────────────────────────────────

btnQuickMeal.addEventListener('click',  () => bridge.meal(60));
btnQuickBolus.addEventListener('click', () => bridge.bolus(parseFloat(bolusAmount.value) || 4));
btnBolus.addEventListener('click', () => {
  const u = parseFloat(bolusAmount.value);
  if (u > 0) bridge.bolus(u);
});
btnMeal.addEventListener('click', () => {
  const c = parseFloat(mealCarbs.value);
  if (c > 0) bridge.meal(c);
});

// ── Therapy changes ───────────────────────────────────────────────────────────

function onTherapyChange(): void {
  const mode = therapyMode.value as 'AID' | 'PUMP' | 'MDI';
  bridge.setTherapyParam({
    mode,
    glucoseTarget:    parseFloat(glucoseTarget.value),
    rapidAnalogue:    rapidAnalogue.value as 'Fiasp' | 'Lispro' | 'Aspart',
    programmedISF:    parseFloat(progISF.value),
    programmedCR:     parseFloat(progCR.value),
    longActingType:   longActingType.value as 'Glargine' | 'Degludec' | 'Detemir',
    longActingDose:   parseFloat(longActingDose.value),
    longActingInjectionTime: timeStringToMinutes(longActingTime.value),
  });
  // Show/hide MDI vs pump sections
  sectionMDI.style.display   = mode === 'MDI'  ? 'block' : 'none';
  sectionBasal.style.display = mode !== 'MDI'  ? 'block' : 'none';
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 22) * 60 + (m ?? 0);
}

[therapyMode, glucoseTarget, rapidAnalogue, progISF, progCR,
 longActingType, longActingDose, longActingTime].forEach(el =>
  el.addEventListener('change', onTherapyChange)
);

// ── Temp basal ────────────────────────────────────────────────────────────────

btnSetTemp.addEventListener('click', () => {
  const rate = parseFloat(tempBasalRate.value);
  const dur  = parseFloat(tempBasalDur.value);
  bridge.setTempBasal(isNaN(rate) ? 0 : rate, isNaN(dur) ? undefined : dur);
  setStatus(`Temp basal: ${rate} U/hr for ${dur} min`);
});

btnCancelTemp.addEventListener('click', () => {
  bridge.cancelTempBasal();
  setStatus('Temp basal cancelled');
});

// ── Basal profile editor ──────────────────────────────────────────────────────

interface BasalSegment { timeMinutes: number; rateUPerHour: number; }

let basalSegments: BasalSegment[] = [{ timeMinutes: 0, rateUPerHour: 0.8 }];

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
      ${i > 0 ? `<button style="padding:4px 8px;background:transparent;border:1px solid var(--red);color:var(--red);border-radius:6px;cursor:pointer;font-size:12px;">×</button>` : '<div style="width:32px;"></div>'}
    `;
    const inputs = row.querySelectorAll('input');
    const timeInput = inputs[0] as HTMLInputElement;
    const rateInput = inputs[1] as HTMLInputElement;
    if (!timeInput.disabled) {
      timeInput.addEventListener('change', () => {
        basalSegments[i]!.timeMinutes = timeStringToMinutes(timeInput.value);
        pushBasalProfile();
      });
    }
    rateInput.addEventListener('change', () => {
      basalSegments[i]!.rateUPerHour = parseFloat(rateInput.value) || 0;
      pushBasalProfile();
    });
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

function minutesToTimeString(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}

function pushBasalProfile(): void {
  const sorted = [...basalSegments].sort((a, b) => a.timeMinutes - b.timeMinutes);
  bridge.setTherapyParam({ basalProfile: sorted });
}

btnAddBasal.addEventListener('click', () => {
  const lastTime = basalSegments[basalSegments.length - 1]?.timeMinutes ?? 0;
  basalSegments.push({ timeMinutes: Math.min(lastTime + 180, 23 * 60), rateUPerHour: 0.8 });
  renderBasalRows();
  pushBasalProfile();
});

renderBasalRows();

// ── Patient changes ───────────────────────────────────────────────────────────

function onPatientChange(): void {
  bridge.setPatientParam({
    trueISF:          parseFloat(trueISF.value),
    trueCR:           parseFloat(trueCR.value),
    weight:           parseFloat(patientWeight.value),
    egpAmplitude:     parseFloat(egpAmp.value),
    egpPeakHour:      parseFloat(egpPeak.value),
    egpBasalLevel:    parseFloat(egpBasal.value),
    carbsAbsTime:     parseFloat(carbsAbsTime.value),
    gastricEmptyingRate: parseFloat(gastricRate.value),
  });
}

[trueISF, trueCR, patientWeight, egpAmp, egpPeak, egpBasal, carbsAbsTime, gastricRate]
  .forEach(el => el.addEventListener('change', onPatientChange));

// ── Overlay toggles ───────────────────────────────────────────────────────────

overlayIOB.addEventListener('change',    () => { renderer.options.showIOB = overlayIOB.checked; renderer.markDirty(); });
overlayCOB.addEventListener('change',    () => { renderer.options.showCOB = overlayCOB.checked; renderer.markDirty(); });
overlayEvents.addEventListener('change', () => { renderer.options.showEvents = overlayEvents.checked; renderer.markDirty(); });
overlayTrue.addEventListener('change',   () => { renderer.options.showTrueGlucose = overlayTrue.checked; renderer.markDirty(); });

// ── Session controls ──────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  bridge.requestSave();
  setStatus('Saved ✓');
});

btnLoad.addEventListener('click', async () => {
  try {
    const s = await loadState();
    if (!s) { setStatus('No saved session found.'); return; }
    bridge.pause(); setRunning(false);
    bridge.reset(s);
    renderer.clearHistory();
    renderer.pushEvents(bridge.getEvents());
    setStatus(`Loaded session at ${formatSimTime(s.simTimeMs)}`);
  } catch (e) {
    setStatus(`Load failed: ${e}`);
  }
});

btnExport.addEventListener('click', () => {
  bridge.requestSave();
  bridge.onStateSaved((s) => exportSession(s));
  setStatus('Exporting...');
});

btnImport.addEventListener('click', async () => {
  try {
    const s = await importSession();
    bridge.pause(); setRunning(false);
    bridge.reset(s);
    renderer.clearHistory();
    renderer.pushEvents(bridge.getEvents());
    setStatus(`Imported session at ${formatSimTime(s.simTimeMs)}`);
  } catch (e) {
    setStatus(`Import failed: ${e}`);
  }
});

btnReset.addEventListener('click', () => {
  if (!confirm('Reset simulation? All current data will be lost.')) return;
  bridge.pause(); setRunning(false);
  // Re-create simulator by resetting to a fresh default state
  const fresh = {
    simTimeMs: 0, trueGlucose: 100, lastCGM: 100,
    patient: { weight:75, age:35, gender:'Male' as const, diabetesDuration:10,
               trueISF:40, trueCR:12, dia:6, tp:75, carbsAbsTime:360,
               egpBasalLevel:0.04, egpAmplitude:1, egpPeakHour:5, gastricEmptyingRate:1 },
    therapy: { mode:'AID' as const, programmedISF:40, programmedCR:12,
               basalProfile:[{timeMinutes:0, rateUPerHour:0.8}],
               rapidAnalogue:'Fiasp' as const, longActingType:'Glargine' as const,
               longActingDose:20, longActingInjectionTime:22*60,
               glucoseTarget:100, correctionThreshold:120 },
    g6State: { v:[0,0] as [number,number], cc:[0,0] as [number,number], tCalib:0, rng:{jsr:123456789^42, seed:42} },
    activeBoluses:[], activeMeals:[], activeLongActing:[],
    pidIntegral:0, pidPrevCGM:100, throttle:10, running:false,
  };
  bridge.reset(fresh);
  renderer.clearHistory();
  setStatus('Simulation reset.');
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  switch (e.key) {
    case ' ': case 'p': e.preventDefault(); btnPause.click(); break;
    case 'ArrowRight': {
      const v = Math.min(parseInt(throttleSlider.value) + 1, THROTTLE_STOPS.length - 1);
      throttleSlider.value = String(v);
      throttleSlider.dispatchEvent(new Event('input'));
      break;
    }
    case 'ArrowLeft': {
      const v = Math.max(parseInt(throttleSlider.value) - 1, 0);
      throttleSlider.value = String(v);
      throttleSlider.dispatchEvent(new Event('input'));
      break;
    }
    case 'm': bridge.meal(60);  break;
    case 'b': bridge.bolus(parseFloat(bolusAmount.value) || 4); break;
    case 'u': unitToggle.click(); break;
  }
});

// ── Initial mode visibility ───────────────────────────────────────────────────

onTherapyChange(); // hide/show MDI vs pump sections

// ── Auto-start ────────────────────────────────────────────────────────────────

bridge.setThrottle(10);
bridge.resume();
setRunning(true);

/**
 * Session import / export — file-based JSON only.
 *
 * v2 envelope carries the complete WorkerState including the chart-trace history
 * (`cgmHistory`), event log (`events`), resolved meal splits, microboluses, temp
 * basal, and the seeded RNG state, so a reloaded session resumes "as if nothing
 * happened" and the chart redraws exactly what was on screen at save time.
 *
 * v1 envelopes (the legacy format) are still loadable but with degraded behaviour:
 * chart starts blank, no markers, fresh seeds for missing fields. The status line
 * flags this with "(legacy)".
 */

import type { WorkerState, DisplayUnit, Prescription, LongActingSchedule, PremixSchedule, PrednisoneSchedule } from '@cgmsim/shared';
import { DEFAULT_PRESCRIPTION } from '@cgmsim/shared';

const ENVELOPE_VERSION = 2;

export function exportSession(state: WorkerState): void {
  const blob = new Blob(
    [JSON.stringify({ version: ENVELOPE_VERSION, exportedAt: Date.now(), state }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `cgmsim-session-${new Date().toISOString().slice(0, 16).replace('T', '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  state: WorkerState;
  /** Envelope version — 1 = legacy (lossy), 2 = full session. */
  version: number;
}

// ── UI preferences (localStorage) ────────────────────────────────────────────
//
// Persisted across reloads, scoped to the browser profile. NOT part of session
// JSON — these describe how the user wants to view the app, not the simulation.

export interface UIPrefs {
  showIOB: boolean;
  showCOB: boolean;
  showBasal: boolean;
  showEvents: boolean;
  showTrueGlucose: boolean;
  showForecast: boolean;
  showBgOverlay: boolean;
  displayUnit: DisplayUnit;
  viewWindowMinutes: number;
  panelOpen: boolean;
  /** MDI prescription — the user's last-saved prescription, restored on reload. */
  prescription: Prescription;
}

const DEFAULT_UI_PREFS: UIPrefs = {
  showIOB: true,
  showCOB: true,
  showBasal: true,
  showEvents: true,
  showTrueGlucose: false,
  showForecast: true,
  showBgOverlay: true,
  displayUnit: 'mmoll',
  viewWindowMinutes: 720,
  panelOpen: false,
  prescription: DEFAULT_PRESCRIPTION,
};

const PREFS_KEY = 'cgmsim.ui-prefs';

export function loadUIPrefs(): UIPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_UI_PREFS };
    const parsed = JSON.parse(raw) as Partial<UIPrefs>;
    return { ...DEFAULT_UI_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function saveUIPrefs(prefs: UIPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* localStorage unavailable */ }
}

// ── Panel overrides (localStorage) ───────────────────────────────────────────
//
// Snapshot of the user's manual edits to the therapy + patient form fields,
// applied on top of the case-template defaults on F5 so edits survive a refresh.
// Cleared whenever the user picks a new case (re-onboarding) or hits "Reset to
// case defaults", since both gestures mean "throw my edits away".
//
// trueISF is stored in mg/dL (canonical) so the snapshot stays correct across
// mg/dL ↔ mmol/L unit toggles. Glucose target is intentionally NOT persisted
// — it always comes from the case template on reload / reset.

export interface PanelOverrides {
  therapy: {
    mode: 'AID' | 'PUMP' | 'MDI';
    progDIA: number;
    rapidAnalogue: 'Fiasp' | 'Lispro' | 'Aspart';
    enableSMB: boolean;
    basalSegments: { timeMinutes: number; rateUPerHour: number }[];
    longActingMorning: LongActingSchedule | null;
    longActingEvening: LongActingSchedule | null;
    laMorningInputs: { type: string; dose: string; time: string };
    laEveningInputs: { type: string; dose: string; time: string };
    tempBasalRate: string;
    tempBasalDuration: string;
    /** Premix (Novomix) BID schedules — null when scenario is off or slot unset. */
    premixMorning?: PremixSchedule | null;
    premixEvening?: PremixSchedule | null;
    premixMorningInputs?: { dose: string; time: string };
    premixEveningInputs?: { dose: string; time: string };
    /** Oral prednisone schedule — null when scenario is off or slot unset. */
    prednisoneSchedule?: PrednisoneSchedule | null;
    prednisoneInputs?: { dose: string; time: string };
  };
  patient: {
    trueISFMgdl: number;
    trueCR: number;
    trueDIA: number;
    weight: number;
    diabetesDuration: number;
    carbsAbsTime: number;
    gastricEmptyingRate: number;
  };
}

const OVERRIDES_KEY = 'cgmsim.panel-overrides';

export function loadPanelOverrides(): PanelOverrides | null {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PanelOverrides;
  } catch {
    return null;
  }
}

export function savePanelOverrides(overrides: PanelOverrides): void {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  } catch { /* localStorage unavailable */ }
}

export function clearPanelOverrides(): void {
  try {
    localStorage.removeItem(OVERRIDES_KEY);
  } catch { /* localStorage unavailable */ }
}

export function importSession(): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as { version?: number; state: WorkerState };
          if (!parsed.state) throw new Error('Invalid session file');
          resolve({ state: parsed.state, version: parsed.version ?? 1 });
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}

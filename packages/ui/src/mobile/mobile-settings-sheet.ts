import type { CGMRenderer } from '../canvas-renderer.js';
import type { InlineSimulator } from '../inline-simulator.js';

const PREFS_KEY = 'cgmsim.mobile.ui-prefs';

export interface MobilePrefs {
  displayUnit: 'mmoll' | 'mgdl';
  ar2: boolean;
  trueGlucose: boolean;
  lastZoom: number;
}

export const DEFAULT_PREFS: MobilePrefs = {
  displayUnit: 'mmoll',
  ar2: true,
  trueGlucose: false,
  lastZoom: 360,
};

export function loadPrefs(): MobilePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: MobilePrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export interface SettingsSheetDeps {
  sim: InlineSimulator;
  renderer: CGMRenderer;
  prefs: MobilePrefs;
  setDisplayUnit: (unit: 'mmoll' | 'mgdl') => void;
  reopenOnboarding: () => void;
  restartSim: () => void;
  submode: 'LIVE' | 'PRESCRIPTION';
  setSubmode: (s: 'LIVE' | 'PRESCRIPTION') => void;
  openPrescriptionSheet: () => void;
}

export function createSettingsSheet(host: HTMLElement, deps: SettingsSheetDeps) {
  const root = document.createElement('div');
  root.className = 'm-sheet-root m-sheet-hidden';
  root.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-side">
      <div class="m-side-head">
        <div class="m-side-title">Settings</div>
        <button class="m-side-close" aria-label="Close">×</button>
      </div>
      <div class="m-side-body" id="m-set-body"></div>
    </div>
  `;
  host.appendChild(root);

  root.querySelector<HTMLElement>('.m-sheet-scrim')!.addEventListener('click', close);
  root.querySelector<HTMLElement>('.m-side-close')!.addEventListener('click', close);

  const body = root.querySelector<HTMLElement>('#m-set-body')!;

  function open() {
    root.classList.remove('m-sheet-hidden');
    render();
  }
  function close() {
    root.classList.add('m-sheet-hidden');
  }

  function render() {
    body.innerHTML = `
      <div class="m-set-row m-set-row-tap" data-act="case">
        <span class="m-set-lbl">Patient case</span>
        <span class="m-set-val">›</span>
      </div>
      <div class="m-set-row" data-act="submode">
        <span class="m-set-lbl">MDI submode</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.submode === 'LIVE' ? 'm-seg-active' : ''}" data-v="LIVE">LIVE</button>
          <button class="m-seg-item ${deps.submode === 'PRESCRIPTION' ? 'm-seg-active' : ''}" data-v="PRESCRIPTION">PRESCR</button>
        </div>
      </div>
      <div class="m-set-row m-set-row-tap ${deps.submode === 'LIVE' ? 'm-set-row-disabled' : ''}" data-act="edit-presc">
        <span class="m-set-lbl">Edit prescription</span>
        <span class="m-set-val">${deps.submode === 'LIVE' ? 'disabled in LIVE ›' : '›'}</span>
      </div>
      <div class="m-set-row" data-act="display-unit">
        <span class="m-set-lbl">Display unit</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.prefs.displayUnit === 'mmoll' ? 'm-seg-active' : ''}" data-v="mmoll">mmol/L</button>
          <button class="m-seg-item ${deps.prefs.displayUnit === 'mgdl' ? 'm-seg-active' : ''}" data-v="mgdl">mg/dL</button>
        </div>
      </div>
      <div class="m-set-row" data-act="ar2">
        <span class="m-set-lbl">AR2 forecast</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.prefs.ar2 ? 'm-seg-active' : ''}" data-v="on">on</button>
          <button class="m-seg-item ${!deps.prefs.ar2 ? 'm-seg-active' : ''}" data-v="off">off</button>
        </div>
      </div>
      <div class="m-set-row" data-act="true-glucose">
        <span class="m-set-lbl">True-glucose overlay</span>
        <div class="m-seg m-seg-sm">
          <button class="m-seg-item ${deps.prefs.trueGlucose ? 'm-seg-active' : ''}" data-v="on">on</button>
          <button class="m-seg-item ${!deps.prefs.trueGlucose ? 'm-seg-active' : ''}" data-v="off">off</button>
        </div>
      </div>
      <div class="m-set-row m-set-row-tap m-set-danger" data-act="restart">
        <span class="m-set-lbl">Restart simulation</span>
        <span class="m-set-val">↻</span>
      </div>
    `;

    body.querySelector<HTMLElement>('[data-act="case"]')!.addEventListener('click', () => {
      close();
      deps.reopenOnboarding();
    });

    body.querySelector<HTMLElement>('[data-act="submode"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.submode = b.dataset['v'] as 'LIVE' | 'PRESCRIPTION';
        deps.setSubmode(deps.submode);
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="edit-presc"]')!.addEventListener('click', () => {
      if (deps.submode === 'LIVE') return;
      deps.openPrescriptionSheet();
    });

    body.querySelector<HTMLElement>('[data-act="display-unit"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.prefs.displayUnit = b.dataset['v'] as 'mmoll' | 'mgdl';
        savePrefs(deps.prefs);
        deps.renderer.options.displayUnit = deps.prefs.displayUnit;
        deps.renderer.markDirty();
        deps.setDisplayUnit(deps.prefs.displayUnit);
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="ar2"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.prefs.ar2 = b.dataset['v'] === 'on';
        savePrefs(deps.prefs);
        deps.renderer.options.showForecast = deps.prefs.ar2;
        deps.renderer.markDirty();
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="true-glucose"]')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        deps.prefs.trueGlucose = b.dataset['v'] === 'on';
        savePrefs(deps.prefs);
        deps.renderer.options.showTrueGlucose = deps.prefs.trueGlucose;
        deps.renderer.markDirty();
        render();
      });
    });

    body.querySelector<HTMLElement>('[data-act="restart"]')!.addEventListener('click', () => {
      if (!confirm('Restart simulation? Current sim state is lost.')) return;
      close();
      deps.restartSim();
    });
  }

  return { open, close };
}

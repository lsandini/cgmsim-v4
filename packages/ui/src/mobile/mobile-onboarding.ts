import { PATIENT_CASES, buildTherapyForCase } from '../onboarding/cases';
import { patientFigureHTML } from '../onboarding/icons';
import type { InlineSimulator } from '../inline-simulator';

const STORAGE_KEY = 'cgmsim.mobile.case';
const CASE_ORDER = ['lean-recent', 'average-established', 'larger-resistant'] as const;
export type CaseId = typeof CASE_ORDER[number];

// TODO: meta strings (kg · ISF) are hardcoded. Verified accurate against
// PATIENT_CASES at write-time (60/75/100 kg, ISF 3.0/2.0/1.2 mmol/L). If
// PATIENT_CASES values change, recompute or replace with dynamic strings:
//   meta: `${CASES[id].patient.weight} kg · ISF ${(CASES[id].patient.trueISF / 18.0182).toFixed(1)}`
const CASE_LABELS: Record<CaseId, { title: string; meta: string; size: 'lean' | 'average' | 'larger' }> = {
  'lean-recent':         { title: 'Lean adult',    meta: '60 kg · ISF 3.0', size: 'lean' },
  'average-established': { title: 'Average adult', meta: '75 kg · ISF 2.0', size: 'average' },
  'larger-resistant':    { title: 'Larger adult',  meta: '100 kg · ISF 1.2', size: 'larger' },
};

export function getStoredCaseId(): CaseId | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && (CASE_ORDER as readonly string[]).includes(raw)) return raw as CaseId;
  return null;
}

export function setStoredCaseId(id: CaseId): void {
  localStorage.setItem(STORAGE_KEY, id);
}

/**
 * Applies a case to the simulator. Assumes a fresh InlineSimulator —
 * does NOT clear activeBoluses, activeMeals, or activeLongActing. If
 * called mid-session (e.g. from a Settings → Patient case re-open),
 * the caller must reset the simulator first (sim.reset(...)) to avoid
 * carryover from the previous case.
 */
export function applyCaseToSim(sim: InlineSimulator, id: CaseId): void {
  const def = PATIENT_CASES[id];
  sim.setPatientParam(def.patient);
  sim.setTherapyParam({ ...buildTherapyForCase(def, 'mdi'), mode: 'MDI', mdiSubmode: 'LIVE' });
}

/**
 * Mounts the onboarding screen on top of `host`. Calls onPick when the user taps Start.
 * Returns a teardown function that removes the screen from the DOM.
 */
export function mountOnboarding(host: HTMLElement, onPick: (id: CaseId) => void): () => void {
  const wrapper = document.createElement('div');
  wrapper.className = 'm-onboarding';
  wrapper.innerHTML = `
    <div class="m-onb-header">
      <div class="m-onb-title">CGMSIM v4 — Mobile</div>
      <div class="m-onb-sub">Pick a patient to get started</div>
    </div>
    <div class="m-onb-row">
      ${CASE_ORDER.map((id) => {
        const lbl = CASE_LABELS[id];
        return `
          <button class="m-onb-card m-onb-${lbl.size}" data-case="${id}">
            <div class="m-onb-figure">${patientFigureHTML(lbl.size, 78)}</div>
            <div class="m-onb-label">${lbl.title}</div>
            <div class="m-onb-meta">${lbl.meta}</div>
          </button>
        `;
      }).join('')}
    </div>
    <button class="m-onb-start" disabled>Start sim →</button>
  `;
  host.appendChild(wrapper);

  let selected: CaseId | null = null;
  const startBtn = wrapper.querySelector<HTMLButtonElement>('.m-onb-start')!;
  const cards = Array.from(wrapper.querySelectorAll<HTMLButtonElement>('.m-onb-card'));

  function syncSelection() {
    cards.forEach((c) => c.classList.toggle('m-onb-selected', c.dataset.case === selected));
    startBtn.disabled = selected === null;
  }

  cards.forEach((c) => {
    c.addEventListener('click', () => {
      selected = c.dataset.case as CaseId;
      syncSelection();
    });
  });

  startBtn.addEventListener('click', () => {
    if (!selected) return;
    onPick(selected);
  });

  syncSelection();

  return () => wrapper.remove();
}

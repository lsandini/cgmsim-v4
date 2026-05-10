import type { Prescription } from '@cgmsim/shared';

const PRESC_KEY = 'cgmsim.mobile.prescription';

export const DEFAULT_PRESCRIPTION: Prescription = {
  fasting: false,
  meals: [
    { hour: 7,  minute: 0, grams: 60, bolusUnits: 8 },
    { hour: 11, minute: 0, grams: 20, bolusUnits: 3 },
    { hour: 13, minute: 0, grams: 75, bolusUnits: 10 },
    { hour: 17, minute: 0, grams: 20, bolusUnits: 3 },
    { hour: 20, minute: 0, grams: 65, bolusUnits: 9 },
  ],
  correction: { units1: 2, units2: 4, units3: 6 },
  fastingCorrectionHours: [7, 13, 17, 22],
};

export function loadPrescription(): Prescription {
  try {
    const raw = localStorage.getItem(PRESC_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION));
    return JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION));
  }
}

export function savePrescription(p: Prescription): void {
  localStorage.setItem(PRESC_KEY, JSON.stringify(p));
}

export function mountPrescriptionSheet(
  host: HTMLElement,
  current: Prescription,
  onChange: (p: Prescription) => void,
): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'm-sheet-root';
  wrap.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-side m-sheet-side-wide">
      <div class="m-side-head">
        <button class="m-side-close" aria-label="Back">‹ Back</button>
        <div class="m-side-title">📋 Prescription</div>
        <div></div>
      </div>
      <div class="m-side-body" id="m-presc-body"></div>
    </div>
  `;
  host.appendChild(wrap);

  const body = wrap.querySelector<HTMLElement>('#m-presc-body')!;
  const closeBtn = wrap.querySelector<HTMLElement>('.m-side-close')!;
  const scrim = wrap.querySelector<HTMLElement>('.m-sheet-scrim')!;
  const teardown = () => wrap.remove();
  closeBtn.addEventListener('click', teardown);
  scrim.addEventListener('click', teardown);

  function render() {
    body.innerHTML = `
      <div class="m-seg" id="m-presc-fasting">
        <button class="m-seg-item ${!current.fasting ? 'm-seg-active' : ''}" data-v="eating">Eating</button>
        <button class="m-seg-item ${current.fasting ? 'm-seg-active' : ''}" data-v="fasting">Fasting</button>
      </div>

      <div class="m-presc-section">
        <div class="m-presc-section-label">Mealtime bolus (units)</div>
        ${current.meals.map((m, i) => `
          <div class="m-presc-row">
            <span class="m-presc-time">${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}</span>
            <span class="m-presc-grams">${m.grams} g</span>
            <span class="m-stepper" data-meal-idx="${i}">
              <button class="m-step-dec">−</button>
              <span class="m-step-val">${m.bolusUnits}</span>
              <button class="m-step-inc">+</button>
            </span>
          </div>
        `).join('')}
      </div>

      <div class="m-presc-section">
        <div class="m-presc-section-label">Sliding scale (correction, U)</div>
        <div class="m-presc-tiers">
          <div class="m-presc-tier">&gt;8 → <strong>${current.correction.units1} U</strong></div>
          <div class="m-presc-tier">&gt;12 → <strong>${current.correction.units2} U</strong></div>
          <div class="m-presc-tier">&gt;16 → <strong>${current.correction.units3} U</strong></div>
        </div>
        <div class="m-presc-note">Sliding-scale tier editing arrives in v2.</div>
      </div>
    `;

    body.querySelector<HTMLElement>('#m-presc-fasting')!.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        current.fasting = b.dataset['v'] === 'fasting';
        savePrescription(current);
        onChange(current);
        render();
      });
    });

    body.querySelectorAll<HTMLElement>('.m-stepper').forEach((stepper) => {
      const idx = parseInt(stepper.dataset['mealIdx']!, 10);
      stepper.querySelector<HTMLButtonElement>('.m-step-dec')!.addEventListener('click', () => {
        current.meals[idx]!.bolusUnits = Math.max(0, current.meals[idx]!.bolusUnits - 1);
        savePrescription(current);
        onChange(current);
        render();
      });
      stepper.querySelector<HTMLButtonElement>('.m-step-inc')!.addEventListener('click', () => {
        current.meals[idx]!.bolusUnits = Math.min(99, current.meals[idx]!.bolusUnits + 1);
        savePrescription(current);
        onChange(current);
        render();
      });
    });
  }

  render();
  return teardown;
}

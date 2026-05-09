import { PATIENT_CASES, THERAPY_OPTIONS, type CaseId, type TherapyChoice } from './cases.js';
import { patientFigureHTML, mdiPensIconHTML, pumpIconHTML, aidPumpIconHTML } from './icons.js';
import { onboardingCSS } from './styles.js';

export interface OnboardingResult {
  caseId: CaseId | null;
  therapy: TherapyChoice | null;
  /** True iff the user ticked the "Prednisone" checkbox embedded in the MDI
   *  therapy card. Only meaningful when therapy === 'mdi'; coerced to false
   *  on close otherwise. */
  withPrednisone: boolean;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.id = 'onboarding-styles';
  style.textContent = onboardingCSS;
  document.head.appendChild(style);
  stylesInjected = true;
}

/** Public entry: ensures onboarding CSS is loaded (idempotent), even if the modal isn't shown. */
export function ensureOnboardingStyles(): void { injectStyles(); }

function figureSizeForCase(id: CaseId): 'lean' | 'average' | 'larger' {
  return id === 'lean-recent' ? 'lean' : id === 'average-established' ? 'average' : 'larger';
}

function iconForTherapy(id: TherapyChoice): string {
  return id === 'mdi' ? mdiPensIconHTML(140)
       : id === 'pump' ? pumpIconHTML(140)
       : aidPumpIconHTML();
}

function renderPatientCards(selected: CaseId | null): string {
  return Object.values(PATIENT_CASES).map(c => `
    <div class="case-card${selected === c.id ? ' selected' : ''}" data-case-id="${c.id}" role="button" tabindex="0" aria-pressed="${selected === c.id}">
      <div class="case-figure">${patientFigureHTML(figureSizeForCase(c.id), 110)}</div>
      <div class="case-label">${c.label}</div>
      <div class="case-sub">${c.description}</div>
    </div>
  `).join('');
}

function renderTherapyCards(selected: TherapyChoice | null, withPrednisone: boolean): string {
  return Object.values(THERAPY_OPTIONS).map(t => {
    const prednisoneCheckbox = t.id === 'mdi' ? `
      <label class="therapy-prednisone-toggle" data-mdi-prednisone>
        <input type="checkbox" ${withPrednisone ? 'checked' : ''} />
        <span>Prednisone</span>
      </label>
    ` : '';
    return `
    <div class="therapy-card${selected === t.id ? ' selected' : ''}" data-therapy-id="${t.id}" role="button" tabindex="0" aria-pressed="${selected === t.id}">
      <div class="therapy-icon">${iconForTherapy(t.id)}</div>
      <div class="therapy-label">${t.label}</div>
      <div class="therapy-sub">${t.description}</div>
      ${prednisoneCheckbox}
    </div>
  `;
  }).join('');
}

export function runOnboarding(): Promise<OnboardingResult> {
  return new Promise((resolve) => {
    injectStyles();

    let step: 1 | 2 | 3 = 1;
    let selectedCase: CaseId | null = null;
    let selectedTherapy: TherapyChoice | null = null;
    let selectedWithPrednisone = false;

    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'onboarding-title');

    overlay.innerHTML = `
      <div class="onboarding-modal">
        <div class="onboarding-header">
          <h2 id="onboarding-title">Welcome</h2>
          <div class="onboarding-step-indicator">Step <span class="ob-current">1</span> of 3</div>
        </div>
        <div class="onboarding-body"></div>
        <div class="onboarding-footer">
          <button class="onboarding-skip" type="button">Skip onboarding</button>
          <div class="onboarding-actions">
            <button class="onboarding-back" type="button" hidden>← Back</button>
            <button class="onboarding-next" type="button">Get started →</button>
          </div>
        </div>
      </div>
    `;

    const titleEl = overlay.querySelector<HTMLElement>('#onboarding-title')!;
    const stepEl  = overlay.querySelector<HTMLElement>('.ob-current')!;
    const bodyEl  = overlay.querySelector<HTMLElement>('.onboarding-body')!;
    const skipBtn = overlay.querySelector<HTMLButtonElement>('.onboarding-skip')!;
    const backBtn = overlay.querySelector<HTMLButtonElement>('.onboarding-back')!;
    const nextBtn = overlay.querySelector<HTMLButtonElement>('.onboarding-next')!;

    function wireCards(selector: string, onPick: (id: string) => void): void {
      bodyEl.querySelectorAll<HTMLElement>(selector).forEach(card => {
        const pick = (): void => {
          bodyEl.querySelectorAll<HTMLElement>(selector).forEach(c => {
            c.classList.remove('selected');
            c.setAttribute('aria-pressed', 'false');
          });
          card.classList.add('selected');
          card.setAttribute('aria-pressed', 'true');
          onPick(card.dataset['caseId'] ?? card.dataset['therapyId'] ?? '');
          nextBtn.disabled = false;
        };
        card.addEventListener('click', pick);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
        });
      });
    }

    function renderStep(): void {
      stepEl.textContent = String(step);
      backBtn.hidden = step === 1;
      bodyEl.classList.toggle('onboarding-body--welcome', step === 1);
      if (step === 1) {
        titleEl.textContent = 'Welcome';
        nextBtn.textContent = 'Get started →';
        nextBtn.disabled = false;
        bodyEl.innerHTML = `
          <div class="onboarding-welcome-title">Welcome to CGMSIM v4</div>
          <p class="onboarding-welcome-message">
            This is a teaching simulator for diabetes education. You'll pick a virtual
            patient and a therapy approach, then explore how blood glucose responds to
            insulin, food, and time. All data is synthetic — this is not a clinical tool.
          </p>
        `;
      } else if (step === 2) {
        titleEl.textContent = 'Choose a patient';
        nextBtn.textContent = 'Next →';
        nextBtn.disabled = selectedCase === null;
        bodyEl.innerHTML = renderPatientCards(selectedCase);
        wireCards('.case-card', (id) => { selectedCase = id as CaseId; });
      } else {
        titleEl.textContent = 'Choose a therapy mode';
        nextBtn.textContent = 'Start simulation';
        nextBtn.disabled = selectedTherapy === null;
        bodyEl.innerHTML = renderTherapyCards(selectedTherapy, selectedWithPrednisone);
        wireCards('.therapy-card', (id) => { selectedTherapy = id as TherapyChoice; });
        // Wire the embedded Prednisone checkbox in the MDI card. Click on the
        // label/checkbox must NOT bubble up to the card click handler — that
        // would re-fire card selection on every toggle.
        const prednisoneToggle = bodyEl.querySelector<HTMLLabelElement>('[data-mdi-prednisone]');
        const prednisoneInput  = prednisoneToggle?.querySelector<HTMLInputElement>('input');
        if (prednisoneToggle && prednisoneInput) {
          prednisoneToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            // Toggling implies the user wants MDI — auto-select that card.
            selectedTherapy = 'mdi';
            bodyEl.querySelectorAll<HTMLElement>('.therapy-card').forEach(c => {
              const isMDI = c.dataset['therapyId'] === 'mdi';
              c.classList.toggle('selected', isMDI);
              c.setAttribute('aria-pressed', String(isMDI));
            });
            nextBtn.disabled = false;
          });
          prednisoneInput.addEventListener('change', () => {
            selectedWithPrednisone = prednisoneInput.checked;
          });
          prednisoneInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
        }
      }
    }

    function close(result: OnboardingResult): void {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        close({ caseId: null, therapy: null, withPrednisone: false });
      }
    }

    skipBtn.addEventListener('click', () => close({ caseId: null, therapy: null, withPrednisone: false }));
    backBtn.addEventListener('click', () => {
      if (step === 3) step = 2;
      else if (step === 2) step = 1;
      renderStep();
    });
    nextBtn.addEventListener('click', () => {
      if (step === 1)      { step = 2; renderStep(); }
      else if (step === 2) { step = 3; renderStep(); }
      else                 {
        // Prednisone scenario is MDI-only — coerce to false for AID/Pump.
        const withPred = selectedTherapy === 'mdi' && selectedWithPrednisone;
        close({ caseId: selectedCase, therapy: selectedTherapy, withPrednisone: withPred });
      }
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    renderStep();
  });
}

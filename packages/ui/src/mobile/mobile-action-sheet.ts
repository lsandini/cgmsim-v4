import { createKeypad } from './mobile-keypad';
import type { LongActingType } from '@cgmsim/shared';

export type ActionKind = 'meal' | 'bolus' | 'longActing';

export interface ActionSheetCallbacks {
  onMeal?: (carbsG: number, gastricEmptyingRate: number) => void;
  onBolus?: (units: number) => void;
  onLongActing?: (type: LongActingType, units: number) => void;
}

// Absolute gastric emptying rates used regardless of case.
// Pedagogic choice: "normal" should produce the same absorption curve across
// all patient cases so students learn a stable mental model of meal timing,
// rather than the rate varying invisibly with case.gastricEmptyingRate.
// Trade-off: ignores per-case physiological variation. Acceptable for v1
// sandbox; revisit if instructors report it feels artificial.
const ABSORPTION_RATES = { slow: 0.6, normal: 1.0, fast: 1.4 };
const LA_TYPES: Array<{ id: LongActingType; label: string }> = [
  { id: 'GlargineU100', label: 'Lantus' },
  { id: 'GlargineU300', label: 'Toujeo' },
  { id: 'Detemir',      label: 'Levemir' },
  { id: 'Degludec',     label: 'Tresiba' },
];

// `cb` is captured in closure for per-action panes (meal/bolus/longActing wires).
export function createActionSheet(host: HTMLElement, cb: ActionSheetCallbacks) {
  const root = document.createElement('div');
  root.className = 'm-sheet-root m-sheet-hidden';
  root.innerHTML = `
    <div class="m-sheet-scrim"></div>
    <div class="m-sheet m-sheet-action">
      <div class="m-sheet-grab"></div>
      <div class="m-sheet-body">
        <!-- picker is rendered here; per-action panes replace it via setView() -->
      </div>
    </div>
  `;
  host.appendChild(root);

  const scrim = root.querySelector<HTMLElement>('.m-sheet-scrim')!;
  const body  = root.querySelector<HTMLElement>('.m-sheet-body')!;

  function open() {
    root.classList.remove('m-sheet-hidden');
    renderPicker();
  }
  function close() {
    root.classList.add('m-sheet-hidden');
    body.innerHTML = '';
  }
  scrim.addEventListener('click', close);

  function renderPicker() {
    body.innerHTML = `
      <div class="m-sheet-title">Add treatment</div>
      <div class="m-action-row">
        <button class="m-action-btn m-action-meal"  data-kind="meal">
          <div class="m-action-ico">🍞</div><div class="m-action-lbl">MEAL</div><div class="m-action-sub">grams</div>
        </button>
        <button class="m-action-btn m-action-bolus" data-kind="bolus">
          <div class="m-action-ico">💉</div><div class="m-action-lbl">RAPID</div><div class="m-action-sub">units</div>
        </button>
        <button class="m-action-btn m-action-la"    data-kind="longActing">
          <div class="m-action-ico">💉</div><div class="m-action-lbl">LONG-ACTING</div><div class="m-action-sub">units + type</div>
        </button>
      </div>
    `;
    body.querySelectorAll<HTMLButtonElement>('.m-action-btn').forEach((b) => {
      b.addEventListener('click', () => routePane(b.dataset.kind as ActionKind));
    });
  }

  function routePane(kind: ActionKind) {
    if (kind === 'meal')        renderMeal();
    if (kind === 'bolus')       renderBolus();
    if (kind === 'longActing')  renderLA();
  }

  function paneShell(title: string, _accent: string, accentVar: string): { kpHost: HTMLElement; rightHost: HTMLElement; } {
    body.innerHTML = `
      <div class="m-pane-head">
        <button class="m-pane-back">‹ Back</button>
        <div class="m-pane-title" style="color: var(${accentVar});">${title}</div>
        <div></div>
      </div>
      <div class="m-pane-grid">
        <div class="m-pane-left"></div>
        <div class="m-pane-right"></div>
      </div>
    `;
    body.querySelector<HTMLButtonElement>('.m-pane-back')!.addEventListener('click', renderPicker);
    return {
      kpHost: body.querySelector<HTMLElement>('.m-pane-left')!,
      rightHost: body.querySelector<HTMLElement>('.m-pane-right')!,
    };
  }

  function renderMeal() {
    const { kpHost, rightHost } = paneShell('🍞 MEAL — grams', 'amber', '--meal-amber');
    const kp = createKeypad(kpHost, { initial: '0', allowDecimal: false, maxLength: 4 }); // up to 9999 g
    let absorption: keyof typeof ABSORPTION_RATES = 'normal';

    rightHost.innerHTML = `
      <div class="m-pane-meta">
        <div class="m-pane-meta-label">Absorption</div>
        <div class="m-seg" id="m-meal-abs">
          <button class="m-seg-item" data-v="slow">slow</button>
          <button class="m-seg-item m-seg-active" data-v="normal">normal</button>
          <button class="m-seg-item" data-v="fast">fast</button>
        </div>
      </div>
      <button class="m-pane-confirm m-confirm-meal">Add now</button>
    `;
    rightHost.querySelectorAll<HTMLButtonElement>('.m-seg-item').forEach((b) => {
      b.addEventListener('click', () => {
        rightHost.querySelectorAll('.m-seg-item').forEach((x) => x.classList.remove('m-seg-active'));
        b.classList.add('m-seg-active');
        const v = b.dataset.v as keyof typeof ABSORPTION_RATES;
        if (v in ABSORPTION_RATES) absorption = v;
      });
    });
    rightHost.querySelector<HTMLButtonElement>('.m-confirm-meal')!.addEventListener('click', () => {
      const grams = parseInt(kp.getValue(), 10);
      if (!Number.isFinite(grams) || grams <= 0) return;
      cb.onMeal?.(grams, ABSORPTION_RATES[absorption]);
      close();
    });
  }

  function renderBolus() {
    const { kpHost, rightHost } = paneShell('💉 RAPID — units', 'blue', '--bolus-blue');
    const kp = createKeypad(kpHost, { initial: '0', allowDecimal: true, maxLength: 5 });  // e.g. 99.99 U
    rightHost.innerHTML = `
      <div class="m-pane-meta"><div class="m-pane-meta-label">Analogue</div><div class="m-pane-meta-value">from case</div></div>
      <button class="m-pane-confirm m-confirm-bolus">Inject now</button>
    `;
    rightHost.querySelector<HTMLButtonElement>('.m-confirm-bolus')!.addEventListener('click', () => {
      const units = parseFloat(kp.getValue());
      if (!Number.isFinite(units) || units <= 0) return;
      cb.onBolus?.(units);
      close();
    });
  }

  function renderLA() {
    const { kpHost, rightHost } = paneShell('💉 LONG-ACTING', 'teal', '--la-teal');
    const kp = createKeypad(kpHost, { initial: '0', allowDecimal: true, maxLength: 5 });  // e.g. 99.99 U
    let type: LongActingType = LA_TYPES[1]!.id; // GlargineU300

    rightHost.innerHTML = `
      <div class="m-pane-meta"><div class="m-pane-meta-label">Type</div></div>
      <div class="m-la-types" id="m-la-types">
        ${LA_TYPES.map((t) => `<button class="m-la-type${t.id === type ? ' m-la-type-active' : ''}" data-id="${t.id}">${t.label}</button>`).join('')}
      </div>
      <button class="m-pane-confirm m-confirm-la">Inject now</button>
    `;
    rightHost.querySelectorAll<HTMLButtonElement>('.m-la-type').forEach((b) => {
      b.addEventListener('click', () => {
        rightHost.querySelectorAll('.m-la-type').forEach((x) => x.classList.remove('m-la-type-active'));
        b.classList.add('m-la-type-active');
        type = b.dataset.id! as LongActingType;
      });
    });
    rightHost.querySelector<HTMLButtonElement>('.m-confirm-la')!.addEventListener('click', () => {
      const units = parseFloat(kp.getValue());
      if (!Number.isFinite(units) || units <= 0) return;
      cb.onLongActing?.(type, units);
      close();
    });
  }

  return { open, close };
}

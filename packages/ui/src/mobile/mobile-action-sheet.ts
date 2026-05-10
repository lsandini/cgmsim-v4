export type ActionKind = 'meal' | 'bolus' | 'longActing';

export interface ActionSheetCallbacks {
  onMeal?: (carbsG: number, gastricEmptyingRate: number) => void;
  onBolus?: (units: number) => void;
  onLongActing?: (type: string, units: number) => void;
}

// `cb` is captured in closure for Task 7's per-action panes (meal/bolus/longActing wires).
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
      b.addEventListener('click', () => {
        const kind = b.dataset.kind as ActionKind;
        // Per-action panes are filled in by Task 7.
        body.innerHTML = `<div class="m-sheet-title">${kind} pane (Task 7)</div>`;
      });
    });
  }

  return { open, close, _body: body };
}

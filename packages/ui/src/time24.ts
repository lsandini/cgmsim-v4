/**
 * Custom 24-hour time picker that replaces the native `<input type="time">` UI.
 *
 * The native picker's display format depends on the OS/browser locale (Chrome
 * shows AM/PM on US-locale machines, Edge often shows 24h). For a teaching
 * tool where evening vs morning long-acting dosing matters, "9:00" without
 * AM/PM is genuinely confusing. This widget always shows HH:MM in 24h.
 *
 * Hover the hour or minute segment and use the scroll wheel to change it.
 * Click a segment to activate it, then ArrowUp/Down to nudge, ArrowLeft/Right
 * to switch segment. The underlying `<input>` element stays in the DOM with
 * its `.value` (always "HH:MM" 24h) as the canonical source — existing code
 * that reads/writes `input.value` keeps working unchanged.
 */

export interface Time24Options {
  /** Minute increment for wheel/arrow steps. Default 5. */
  minuteStep?: number;
}

const NATIVE_VALUE_DESC = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value',
)!;
const nativeGet = NATIVE_VALUE_DESC.get!;
const nativeSet = NATIVE_VALUE_DESC.set!;

function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const h = parseInt(m[1]!, 10), mm = parseInt(m[2]!, 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
}

function formatHM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function enhanceTimeInput(
  input: HTMLInputElement,
  opts: Time24Options = {},
): void {
  if ((input as any)._time24) return; // already enhanced
  const step = opts.minuteStep ?? 5;

  const minTotal = parseHM(input.min) ?? 0;
  const maxTotal = parseHM(input.max) ?? 23 * 60 + 59;
  const disabled = input.disabled;

  const widget = document.createElement('span');
  widget.className = 'time24';
  if (disabled) widget.classList.add('disabled');
  widget.tabIndex = disabled ? -1 : 0;
  widget.innerHTML =
    `<span class="t24-h" data-part="h">00</span>` +
    `<span class="t24-sep">:</span>` +
    `<span class="t24-m" data-part="m">00</span>`;

  // Carry across the native input's inline width so layout doesn't shift.
  if (input.style.width) widget.style.width = input.style.width;

  input.style.display = 'none';
  input.parentNode!.insertBefore(widget, input.nextSibling);

  const hEl = widget.querySelector('.t24-h') as HTMLElement;
  const mEl = widget.querySelector('.t24-m') as HTMLElement;

  let total = 0;
  let activePart: 'h' | 'm' = 'h';

  const clamp = (t: number) => Math.max(minTotal, Math.min(maxTotal, t));

  function render(): void {
    const s = formatHM(total);
    hEl.textContent = s.slice(0, 2);
    mEl.textContent = s.slice(3, 5);
    hEl.classList.toggle('active', activePart === 'h');
    mEl.classList.toggle('active', activePart === 'm');
  }

  function commit(newTotal: number, fire = true): void {
    const t = clamp(newTotal);
    if (t === total && fire) return;
    total = t;
    nativeSet.call(input, formatHM(total));
    render();
    if (fire) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Override `.value` on this specific element so external assignments like
  // `input.value = "08:00"` update the widget. Reads/writes still produce the
  // same "HH:MM" 24h string the rest of the code expects.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return formatHM(total); },
    set(v: string) {
      const parsed = parseHM(String(v));
      total = clamp(parsed ?? minTotal);
      nativeSet.call(input, formatHM(total));
      render();
    },
  });

  // Initialize from whatever the native input was rendered with.
  const initial = parseHM(nativeGet.call(input)) ?? minTotal;
  total = clamp(initial);
  nativeSet.call(input, formatHM(total));
  render();

  const isDisabled = () => widget.classList.contains('disabled');

  widget.addEventListener('wheel', (e: WheelEvent) => {
    if (isDisabled()) return;
    const part = (e.target as HTMLElement | null)
      ?.closest('[data-part]')
      ?.getAttribute('data-part') as 'h' | 'm' | null;
    if (part === 'h' || part === 'm') activePart = part;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    commit(total + dir * (activePart === 'h' ? 60 : step));
  }, { passive: false });

  widget.addEventListener('mousedown', (e: MouseEvent) => {
    if (isDisabled()) return;
    const part = (e.target as HTMLElement | null)
      ?.closest('[data-part]')
      ?.getAttribute('data-part') as 'h' | 'm' | null;
    if (part === 'h' || part === 'm') {
      activePart = part;
      render();
    }
  });

  widget.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isDisabled()) return;
    switch (e.key) {
      case 'ArrowUp':
        commit(total + (activePart === 'h' ? 60 : step));
        e.preventDefault();
        break;
      case 'ArrowDown':
        commit(total - (activePart === 'h' ? 60 : step));
        e.preventDefault();
        break;
      case 'ArrowLeft':
        activePart = 'h';
        render();
        e.preventDefault();
        break;
      case 'ArrowRight':
        activePart = 'm';
        render();
        e.preventDefault();
        break;
      case 'Home':
        commit(minTotal);
        e.preventDefault();
        break;
      case 'End':
        commit(maxTotal);
        e.preventDefault();
        break;
    }
  });

  widget.addEventListener('focus', () => widget.classList.add('focused'));
  widget.addEventListener('blur',  () => widget.classList.remove('focused'));

  (input as any)._time24 = widget;
}

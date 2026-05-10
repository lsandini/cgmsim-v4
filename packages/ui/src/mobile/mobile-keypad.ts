export interface KeypadOptions {
  initial?: string;          // initial display value (e.g. '0')
  allowDecimal?: boolean;    // default true
  maxLength?: number;        // default 6
  onChange?: (value: string) => void;
}

export function createKeypad(host: HTMLElement, opts: KeypadOptions = {}) {
  const allowDecimal = opts.allowDecimal !== false;
  const maxLength = opts.maxLength ?? 6;
  let value = opts.initial ?? '0';

  const display = document.createElement('div');
  display.className = 'm-kp-display';
  display.textContent = value;

  const grid = document.createElement('div');
  grid.className = 'm-kp-grid';
  const keys = ['1','2','3','4','5','6','7','8','9', allowDecimal ? '.' : '', '0', '⌫'];
  keys.forEach((k) => {
    const btn = document.createElement('button');
    btn.className = 'm-kp-key';
    btn.textContent = k;
    if (!k) btn.style.visibility = 'hidden';
    btn.addEventListener('click', () => press(k));
    grid.appendChild(btn);
  });

  function press(k: string): void {
    if (!k) return;
    if (k === '⌫') {
      value = value.length > 1 ? value.slice(0, -1) : '0';
    } else if (k === '.') {
      if (!value.includes('.') && value.length < maxLength) value = value + '.';
    } else {
      if (value === '0') value = k;
      else if (value.length < maxLength) value = value + k;
    }
    display.textContent = value;
    opts.onChange?.(value);
  }

  function setValue(v: string): void {
    value = v;
    display.textContent = v;
  }

  function getValue(): string { return value; }

  host.appendChild(display);
  host.appendChild(grid);

  return { setValue, getValue };
}

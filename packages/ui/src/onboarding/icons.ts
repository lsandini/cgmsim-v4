// Inline SVG factories. Each returns an HTML string ready to drop into innerHTML.
// Real patient figures will replace the circle placeholders later — same call sites.

type FigureSize = 'lean' | 'average' | 'larger';

export function patientFigureHTML(size: FigureSize, px = 96): string {
  const r = size === 'lean' ? 18 : size === 'average' ? 26 : 35;
  const h = Math.round((px * 140) / 80);
  return `<svg viewBox="0 0 80 140" width="${px}" height="${h}" aria-hidden="true">
    <circle cx="40" cy="70" r="${r}" fill="none" stroke="currentColor" stroke-width="3" />
  </svg>`;
}

/** Pen icon — vertical insulin pen: cap, body, dose window, dose dial, needle. */
export function penIconHTML(px = 80): string {
  const h = Math.round((px * 140) / 60);
  return `<svg viewBox="0 0 60 140" width="${px}" height="${h}" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="20" y="6"   width="20" height="36" rx="3" />
      <rect x="22" y="44"  width="16" height="56" rx="2" />
      <rect x="25" y="60"  width="10" height="14" rx="1" />
      <rect x="20" y="100" width="20" height="18" rx="3" />
      <rect x="26" y="118" width="8"  height="6" />
      <line x1="30" y1="124" x2="30" y2="134" />
    </g>
  </svg>`;
}

/** Standard pump icon — pump body + tubing + infusion site + insulin vial. */
export function pumpIconHTML(px = 140): string {
  const h = Math.round((px * 76) / 145);
  return `<svg viewBox="0 0 145 76" width="${px}" height="${h}" aria-hidden="true">
    <g fill="currentColor" stroke="currentColor">
      <rect x="5" y="2" width="50" height="40" rx="8" ry="8" fill="none" stroke-width="2.5" />
      <rect x="11" y="8" width="28" height="18" rx="2" ry="2" fill="none" stroke-width="2" />
      <polygon points="48,12 52,18 44,18" stroke="none" />
      <polygon points="48,30 52,24 44,24" stroke="none" />
      <circle cx="16" cy="34" r="2" stroke="none" />
      <circle cx="25" cy="34" r="2" stroke="none" />
      <circle cx="34" cy="34" r="2" stroke="none" />
      <path d="M 18 42 A 22 22 0 0 0 62 42" fill="none" stroke-width="2.5" stroke-linecap="round" />
      <circle cx="74" cy="42" r="12" fill="none" stroke-width="2.5" />
      <circle cx="74" cy="42" r="3" stroke="none" />
      <rect x="110" y="8" width="14" height="7" rx="2" ry="2" stroke="none" />
      <path d="M 110 15 L 110 19 Q 110 22, 103 22 L 103 22" fill="none" stroke-width="2" stroke-linejoin="round" />
      <path d="M 124 15 L 124 19 Q 124 22, 131 22 L 131 22" fill="none" stroke-width="2" stroke-linejoin="round" />
      <rect x="103" y="22" width="28" height="35" rx="4" ry="4" fill="none" stroke-width="2" />
      <rect x="106" y="40" width="22" height="14" stroke="none" />
    </g>
  </svg>`;
}

/**
 * AID pump icon — same pump silhouette, with wireless arcs above the body
 * and a small CGM sensor disk near the infusion site indicating closed-loop control.
 */
export function aidPumpIconHTML(px = 140): string {
  const h = Math.round((px * 90) / 145);
  return `<svg viewBox="0 0 145 90" width="${px}" height="${h}" aria-hidden="true">
    <g fill="currentColor" stroke="currentColor">
      <!-- wireless / signal arcs above the pump body -->
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M 25 14 Q 30 8, 35 14" />
        <path d="M 21 18 Q 30 4, 39 18" />
      </g>
      <!-- pump body (shifted down by 14 to make room for arcs) -->
      <g transform="translate(0, 14)">
        <rect x="5" y="2" width="50" height="40" rx="8" ry="8" fill="none" stroke-width="2.5" />
        <rect x="11" y="8" width="28" height="18" rx="2" ry="2" fill="none" stroke-width="2" />
        <polygon points="48,12 52,18 44,18" stroke="none" />
        <polygon points="48,30 52,24 44,24" stroke="none" />
        <circle cx="16" cy="34" r="2" stroke="none" />
        <circle cx="25" cy="34" r="2" stroke="none" />
        <circle cx="34" cy="34" r="2" stroke="none" />
        <path d="M 18 42 A 22 22 0 0 0 62 42" fill="none" stroke-width="2.5" stroke-linecap="round" />
        <circle cx="74" cy="42" r="12" fill="none" stroke-width="2.5" />
        <circle cx="74" cy="42" r="3" stroke="none" />
        <!-- CGM sensor disk (right of infusion site) -->
        <circle cx="98" cy="42" r="8" fill="none" stroke-width="2.5" />
        <circle cx="98" cy="42" r="2" stroke="none" />
        <!-- dotted feedback line: sensor → pump -->
        <path d="M 90 42 Q 75 60, 30 42" fill="none" stroke-width="1.8" stroke-dasharray="2 3" stroke-linecap="round" />
        <!-- vial -->
        <rect x="120" y="8" width="14" height="7" rx="2" ry="2" stroke="none" />
        <path d="M 120 15 L 120 19 Q 120 22, 113 22 L 113 22" fill="none" stroke-width="2" stroke-linejoin="round" />
        <path d="M 134 15 L 134 19 Q 134 22, 141 22 L 141 22" fill="none" stroke-width="2" stroke-linejoin="round" />
        <rect x="113" y="22" width="28" height="35" rx="4" ry="4" fill="none" stroke-width="2" />
        <rect x="116" y="40" width="22" height="14" stroke="none" />
      </g>
    </g>
  </svg>`;
}

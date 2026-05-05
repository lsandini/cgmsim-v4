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

/**
 * MDI pens icon — two stacked horizontal insulin pens (long-acting basal on
 * top with a teal cartridge, mealtime rapid-acting on the bottom with an
 * orange cartridge). Outlines use currentColor so they adapt to dark/light
 * theme; only the cartridge fills are fixed colors.
 */
export function mdiPensIconHTML(px = 140): string {
  const h = Math.round((px * 110) / 160);
  return `<svg viewBox="0 0 160 110" width="${px}" height="${h}" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <!-- Long-acting basal pen (teal cartridge) -->
      <g>
        <rect x="6"   y="20" width="36" height="20" rx="3" />
        <rect x="44"  y="22" width="76" height="16" rx="2" fill="#14b8a6" />
        <rect x="72"  y="25" width="14" height="10" rx="1" />
        <rect x="120" y="20" width="18" height="20" rx="3" />
        <rect x="138" y="26" width="6"  height="8" />
        <line x1="144" y1="30" x2="154" y2="30" />
      </g>
      <!-- Mealtime rapid-acting pen (orange cartridge) -->
      <g transform="translate(0, 50)">
        <rect x="6"   y="20" width="36" height="20" rx="3" />
        <rect x="44"  y="22" width="76" height="16" rx="2" fill="#fb923c" />
        <rect x="72"  y="25" width="14" height="10" rx="1" />
        <rect x="120" y="20" width="18" height="20" rx="3" />
        <rect x="138" y="26" width="6"  height="8" />
        <line x1="144" y1="30" x2="154" y2="30" />
      </g>
    </g>
  </svg>`;
}

/** Standard pump icon — pump body + tubing + infusion site + insulin vial.
 *  The insulin liquid inside the vial is filled sky-blue (#60a5fa) to match
 *  the bolus-marker color used on the chart. */
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
      <rect x="106" y="40" width="22" height="14" stroke="none" fill="#60a5fa" />
    </g>
  </svg>`;
}

/**
 * AID pump icon — identical pump+vial silhouette as standard pump, framed by
 * a 3-arrow closed-loop glyph that orbits clockwise around the whole
 * composition. The loop is drawn first (behind), so the pump renders on top.
 *
 * Default px is 193 so the inner pump composition (145 user units wide)
 * renders at the same 140px as `pumpIconHTML(140)` — i.e. the pump in the
 * AID card visually matches the pump in the standard-pump card. The overall
 * AID icon is wider/taller because of the surrounding loop.
 */
export function aidPumpIconHTML(px = 193): string {
  const h = Math.round((px * 115) / 200);
  return `<svg viewBox="0 0 200 115" width="${px}" height="${h}" aria-hidden="true">
    <defs>
      <marker id="aid-loop-arrow" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 10 5 L 0 10 Z" style="fill: var(--cgm, #22c55e);" />
      </marker>
    </defs>
    <g fill="currentColor" stroke="currentColor">
      <!-- Closed-loop glyph (rendered behind): 3 clockwise elliptical arrows
           orbiting (cx,cy)=(100,57.5), rx=90, ry=55. The pump bbox sits fully
           inside this ellipse with ~27 user-units of margin on every side.
           Stroke + arrowhead use var(--cgm) so the loop matches the bright
           green of the CGM trace and adapts on theme change. -->
      <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" marker-end="url(#aid-loop-arrow)" style="color: var(--cgm, #22c55e);">
        <path d="M 100 2.5 A 90 55 0 0 1 186.9 71.7" />
        <path d="M 177.9 85 A 90 55 0 0 1 36.4 96.4" />
        <path d="M 22.1 85 A 90 55 0 0 1 76.7 4.4" />
      </g>
      <!-- Pump + vial: identical to standard pump (pumpIconHTML), centered within the loop. -->
      <g transform="translate(32, 28)">
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
        <rect x="106" y="40" width="22" height="14" stroke="none" fill="#60a5fa" />
      </g>
    </g>
  </svg>`;
}

// Inline SVG factories. Each returns an HTML string ready to drop into innerHTML.

type FigureSize = 'lean' | 'average' | 'larger';

/**
 * Patient body figures cropped from a public-domain silhouette set
 * (uIKXf01.svg). Each variant uses its own viewBox into the original
 * coordinate system; all share the standard fontforge-style transform
 * (`translate(0,196) scale(0.1,-0.1)`). Figures are filled with
 * currentColor so they adapt to theme.
 *
 * `px` is the display HEIGHT of the SVG. Widths are derived per-figure
 * from the source viewBox so all three render at the same height with
 * proportionally narrower/wider bodies — a "same person, different
 * fatness" visual.
 */
// export function patientFigureHTML(size: FigureSize, px = 110): string {
//   const lean = `<path d="M518 1761 c-134 -43 -159 -219 -42 -292 135 -83 296 64 227 208 -30 64 -120 104 -185 84z m109 -47 c91 -59 77 -187 -25 -231 -43 -18 -98 -4 -137 37 -24 25 -29 39 -29 84 -1 44 4 59 24 81 50 54 113 65 167 29z"/>
//       <path d="M393 1394 c-48 -24 -68 -64 -106 -210 -19 -71 -47 -175 -62 -231 -17 -61 -25 -112 -21 -127 8 -34 49 -60 81 -52 41 10 61 42 80 129 10 45 21 85 24 89 3 4 6 -175 6 -397 l0 -405 26 -26 c32 -31 90 -36 120 -8 18 16 20 16 39 -1 29 -27 88 -22 120 10 l25 25 0 405 c0 223 3 405 8 405 4 0 7 -8 7 -17 0 -41 35 -165 52 -183 41 -44 110 -30 124 26 8 31 -106 470 -134 518 -32 54 -71 66 -222 66 -103 0 -143 -4 -167 -16z m336 -40 c34 -28 46 -63 121 -347 23 -86 39 -166 35 -177 -8 -26 -43 -36 -63 -17 -8 9 -33 84 -56 168 -23 84 -47 154 -54 157 -9 3 -12 -95 -12 -460 0 -517 1 -508 -64 -508 -19 0 -39 6 -45 13 -7 9 -12 107 -13 293 -3 240 -5 279 -18 279 -13 0 -15 -39 -17 -278 -2 -195 -6 -283 -14 -293 -6 -8 -26 -14 -45 -14 -65 0 -64 -9 -64 508 0 351 -3 463 -12 460 -6 -2 -30 -72 -52 -155 -50 -185 -68 -211 -111 -163 -18 20 -17 27 45 258 57 211 68 241 96 270 l32 32 140 0 c136 0 141 -1 171 -26z"/>`;
//   const average = `<path d="M1600 1748 c-61 -31 -90 -77 -90 -143 0 -169 226 -221 300 -69 24 48 25 82 6 128 -17 41 -50 73 -95 92 -46 19 -69 18 -121 -8z m140 -37 c125 -87 22 -282 -119 -225 -75 30 -104 120 -60 190 11 19 21 34 22 34 1 0 20 7 42 14 45 16 78 12 115 -13z"/>
//       <path d="M1475 1396 c-47 -20 -83 -70 -104 -144 -51 -176 -101 -374 -101 -402 0 -35 40 -80 72 -80 24 0 59 18 74 39 7 8 20 51 29 95 10 45 21 84 24 88 3 4 6 -173 6 -392 l0 -400 30 -30 c40 -39 92 -43 137 -10 27 20 32 21 40 7 11 -20 67 -36 102 -30 14 3 38 19 51 35 l26 30 -3 399 c-2 220 0 399 3 399 4 0 16 -43 28 -95 24 -102 48 -135 98 -135 28 0 83 50 83 75 0 16 -27 121 -91 360 -52 190 -74 205 -311 205 -113 -1 -172 -5 -193 -14z m409 -56 c32 -32 40 -54 96 -259 33 -123 58 -232 55 -242 -8 -24 -41 -42 -64 -34 -11 3 -24 18 -30 33 -9 25 -81 287 -81 297 0 3 -7 5 -15 5 -13 0 -15 -58 -15 -465 0 -452 -1 -466 -20 -485 -30 -30 -83 -27 -109 6 -20 26 -21 39 -21 295 0 232 -2 269 -15 269 -13 0 -15 -37 -15 -275 0 -262 -1 -276 -20 -295 -25 -25 -81 -26 -103 -2 -15 16 -17 68 -19 483 -3 546 -6 558 -72 310 -33 -122 -46 -157 -64 -169 -19 -13 -27 -13 -47 -2 -32 17 -32 35 1 158 93 353 97 362 147 393 29 18 47 19 204 17 l173 -3 34 -35z"/>`;
//   const larger = `<path d="M4062 1757 c-73 -23 -122 -107 -108 -182 10 -52 70 -113 121 -125 74 -17 154 21 181 86 36 85 5 171 -76 212 -48 24 -67 26 -118 9z m125 -46 c51 -38 68 -113 38 -170 -8 -17 -34 -38 -59 -51 -38 -18 -50 -20 -85 -10 -72 19 -118 105 -91 169 33 80 131 111 197 62z"/>
//       <path d="M3880 1390 c-95 -44 -111 -73 -174 -311 -50 -191 -54 -227 -30 -264 21 -32 83 -52 113 -36 20 11 21 10 21 -31 0 -80 45 -340 85 -493 19 -69 53 -111 98 -118 36 -5 85 12 106 37 12 15 16 14 38 -8 67 -67 169 -21 193 86 47 213 63 297 75 396 8 62 14 116 14 120 -3 19 2 23 16 12 38 -31 135 28 135 83 0 31 -89 366 -109 412 -20 45 -61 89 -106 113 -25 14 -66 17 -230 20 -185 2 -203 1 -245 -18z m448 -25 c85 -36 102 -69 167 -313 42 -158 47 -185 36 -206 -16 -30 -55 -48 -85 -40 -22 5 -24 14 -35 107 -18 151 -34 222 -51 222 -17 0 -17 -3 5 -110 23 -109 23 -321 0 -450 -34 -200 -75 -358 -97 -382 -28 -30 -83 -31 -115 -1 -23 21 -23 22 -23 295 0 236 -2 273 -15 273 -13 0 -15 -36 -15 -260 0 -312 -5 -330 -89 -330 -64 0 -75 26 -132 300 -29 139 -32 173 -33 330 0 130 5 194 17 248 21 89 21 92 3 92 -10 0 -19 -19 -26 -56 -17 -83 -30 -174 -30 -221 0 -32 -5 -45 -20 -53 -41 -22 -100 15 -100 61 0 42 86 357 111 406 20 40 43 60 99 90 39 20 378 18 428 -2z"/>`;
//   const spec = size === 'lean' ? { vb: '0 0 110 196',   figW: 110, body: lean }
//             : size === 'average' ? { vb: '105 0 115 196', figW: 115, body: average }
//             :                       { vb: '346 0 122 196', figW: 122, body: larger };
//   const w = Math.round((px * spec.figW) / 196);
//   return `<svg viewBox="${spec.vb}" width="${w}" height="${px}" aria-hidden="true">
//     <g transform="translate(0,196) scale(0.1,-0.1)" fill="currentColor" stroke="none">
//       ${spec.body}
//     </g>
//   </svg>`;
// }

export function patientFigureHTML(size: FigureSize, px = 110): string {
  const rotation = size === 'lean'    ? -72
                 : size === 'average' ? 0
                 :                       72;

  const segments = `
    <path d="M 0 110 A 90 90 0 0 1 17.21 57.10 L 35.81 70.62 A 67 67 0 0 0 23 110 Z" fill="#2E7D32"/>
    <path d="M 17.21 57.10 A 90 90 0 0 1 62.19 24.40 L 69.30 46.30 A 67 67 0 0 0 35.81 70.62 Z" fill="#7CB342"/>
    <path d="M 62.19 24.40 A 90 90 0 0 1 117.81 24.40 L 110.70 46.30 A 67 67 0 0 0 69.30 46.30 Z" fill="#FDD835"/>
    <path d="M 117.81 24.40 A 90 90 0 0 1 162.79 57.10 L 144.19 70.62 A 67 67 0 0 0 110.70 46.30 Z" fill="#FB8C00"/>
    <path d="M 162.79 57.10 A 90 90 0 0 1 180 110 L 157 110 A 67 67 0 0 0 144.19 70.62 Z" fill="#D32F2F"/>`;

  // Single-path needle: wedge tip at (0,-83), sides converge to a round base
  // of radius 11 centered at (0,+1). Hole of radius 4 at the rotation axis
  // (0,0), cut out via fill-rule="evenodd".
  const needle = `
    <path transform="translate(90, 110) rotate(${rotation})"
          fill-rule="evenodd"
          fill="currentColor" stroke="none"
          d="M 0 -83 L 11 1 A 11 11 0 1 1 -11 1 L 0 -83 Z M 0 0 m -4 0 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0 Z"/>`;

  const w = Math.round((px * 180) / 130);

  return `<svg viewBox="0 0 180 130" width="${w}" height="${px}"
       stroke="var(--card-bg, #0e1a2b)" stroke-width="3" stroke-linejoin="round"
       aria-hidden="true">
    ${segments}
    ${needle}
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

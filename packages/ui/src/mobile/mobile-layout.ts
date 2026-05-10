import type { TickSnapshot } from '@cgmsim/shared';

export interface MobileLayoutHandles {
  bgChip: HTMLElement;
  iobPill: HTMLElement;
  cobPill: HTMLElement;
  simTime: HTMLElement;
  hamburger: HTMLElement;
  speedPill: HTMLElement;
  fab: HTMLElement;
  setDisplayUnit: (unit: 'mmoll' | 'mgdl') => void;
  applyTick: (snap: TickSnapshot) => void;
}

export function createMobileLayout(root: HTMLElement): MobileLayoutHandles {
  // Build DOM structure
  root.insertAdjacentHTML('beforeend', `
    <div class="m-overlay m-top">
      <div class="m-pill m-iob" id="m-iob">IOB —</div>
      <div class="m-bgchip" id="m-bgchip">— mmol/L</div>
      <div class="m-pill m-cob" id="m-cob">COB —</div>
      <button class="m-icon-btn m-hamburger" id="m-hamburger" aria-label="Settings">☰</button>
      <div class="m-simtime" id="m-simtime">—</div>
    </div>
    <div class="m-overlay m-bottom">
      <button class="m-pill m-speed" id="m-speed">⏸ ×360</button>
      <button class="m-fab" id="m-fab" aria-label="Add treatment">+</button>
    </div>
  `);

  const bgChip = root.querySelector<HTMLElement>('#m-bgchip')!;
  const iobPill = root.querySelector<HTMLElement>('#m-iob')!;
  const cobPill = root.querySelector<HTMLElement>('#m-cob')!;
  const simTime = root.querySelector<HTMLElement>('#m-simtime')!;
  const hamburger = root.querySelector<HTMLElement>('#m-hamburger')!;
  const speedPill = root.querySelector<HTMLElement>('#m-speed')!;
  const fab = root.querySelector<HTMLElement>('#m-fab')!;

  let displayUnit: 'mmoll' | 'mgdl' = 'mmoll';

  function fmtBg(mgdl: number): string {
    if (displayUnit === 'mgdl') return `${Math.round(mgdl)} mg/dL`;
    return `${(mgdl / 18.0182).toFixed(1)} mmol/L`;
  }

  function bgZoneClass(mgdl: number): string {
    if (mgdl < 70) return 'm-zone-low';
    if (mgdl > 180) return 'm-zone-high';
    return 'm-zone-good';
  }

  function applyTick(snap: TickSnapshot): void {
    bgChip.textContent = fmtBg(snap.cgm);
    bgChip.className = 'm-bgchip ' + bgZoneClass(snap.cgm);
    iobPill.textContent = `IOB ${snap.iob.toFixed(1)} U`;
    cobPill.textContent = `COB ${Math.round(snap.cob)} g`;

    const totalMin = Math.floor(snap.simTimeMs / 60000);
    const dayMin = totalMin % 1440;
    const hh = Math.floor(dayMin / 60).toString().padStart(2, '0');
    const mm = (dayMin % 60).toString().padStart(2, '0');
    const isDay = dayMin >= 360 && dayMin < 1080; // 06:00 to 18:00
    simTime.textContent = `${isDay ? '☀' : '☾'} ${hh}:${mm}`;
  }

  return {
    bgChip, iobPill, cobPill, simTime, hamburger, speedPill, fab,
    setDisplayUnit: (u) => { displayUnit = u; },
    applyTick,
  };
}

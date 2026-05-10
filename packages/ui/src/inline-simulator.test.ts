import { describe, it, expect } from 'vitest';
import { InlineSimulator } from './inline-simulator.js';

describe('InlineSimulator.injectLongActingNow', () => {
  it('appends an ActiveLongActing record stamped with peak/duration from patient weight', () => {
    const sim = new InlineSimulator();
    sim.setPatientParam({ weight: 70 });

    sim.injectLongActingNow('GlargineU100', 20);

    const state = sim.getCurrentState();
    expect(state.activeLongActing).toHaveLength(1);

    const dose = state.activeLongActing[0]!;
    expect(dose.type).toBe('GlargineU100');
    expect(dose.units).toBe(20);
    // GlargineU100: duration = (22 + 12 * 20 / 70) * 60 ≈ 1525.7 min, peak = duration / 2.5 ≈ 610.3 min
    expect(dose.duration).toBeCloseTo(1525.7, 0);
    expect(dose.peak).toBeCloseTo(610.3, 0);
    expect(dose.simTimeMs).toBe(state.simTimeMs);
  });

  it('emits a SimEvent of kind longActing synchronously', () => {
    const sim = new InlineSimulator();
    const capturedEvents: any[] = [];
    sim.onEvent((evs) => { capturedEvents.push(...evs); });

    sim.injectLongActingNow('Detemir', 10);

    expect(capturedEvents.some((e) => e.kind === 'longActing' && e.units === 10)).toBe(true);
  });
});

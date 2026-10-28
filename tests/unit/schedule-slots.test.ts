import { describe, expect, it } from 'vitest';
import { getDueSlot, getNextSlot, getPreviousSlot } from '../../src/modules/scheduler/schedule-slots';

const PARIS = 'Europe/Paris';
// Thursday at 08:00 and 18:30, Paris time
const thursday = { days: [4], times: ['08:00', '18:30'] };

describe('schedule slots', () => {
  it('resolves wall-clock times in the configured zone', () => {
    // Wednesday 2026-10-21 12:00 Paris (CEST, UTC+2)
    const now = new Date('2026-10-21T10:00:00.000Z');
    expect(getNextSlot(thursday, PARIS, now)?.toISOString()).toBe('2026-10-22T06:00:00.000Z');
    expect(getPreviousSlot(thursday, PARIS, now)?.toISOString()).toBe('2026-10-15T16:30:00.000Z');
  });

  it('keeps the local time across a DST change', () => {
    // Clocks go back on 2026-10-25: Thursday 29th 08:00 Paris is UTC+1
    const now = new Date('2026-10-26T10:00:00.000Z');
    expect(getNextSlot(thursday, PARIS, now)?.toISOString()).toBe('2026-10-29T07:00:00.000Z');
  });

  it('runs the latest slot once, then waits for the next one', () => {
    const slot = new Date('2026-10-22T06:00:00.000Z');
    const justAfter = new Date('2026-10-22T06:00:30.000Z');
    expect(getDueSlot(thursday, PARIS, null, justAfter)?.toISOString()).toBe(slot.toISOString());
    expect(getDueSlot(thursday, PARIS, slot, justAfter)).toBeNull();
    expect(getDueSlot(thursday, PARIS, slot, new Date('2026-10-22T16:31:00.000Z'))?.toISOString()).toBe(
      '2026-10-22T16:30:00.000Z',
    );
  });

  it('catches up a recently missed slot but not an old one', () => {
    const lastHandled = new Date('2026-10-15T16:30:00.000Z');
    expect(getDueSlot(thursday, PARIS, lastHandled, new Date('2026-10-22T11:00:00.000Z'))?.toISOString()).toBe(
      '2026-10-22T06:00:00.000Z',
    );
    // Friday afternoon: Thursday 18:30 is more than 12 hours old
    expect(getDueSlot(thursday, PARIS, lastHandled, new Date('2026-10-23T14:00:00.000Z'))).toBeNull();
  });

  it('never fires without days or times', () => {
    const now = new Date('2026-10-22T06:00:30.000Z');
    expect(getDueSlot({ days: [], times: ['08:00'] }, PARIS, null, now)).toBeNull();
    expect(getDueSlot({ days: [4], times: [] }, PARIS, null, now)).toBeNull();
    expect(getNextSlot({ days: [4], times: [] }, PARIS, now)).toBeNull();
  });
});

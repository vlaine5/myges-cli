import { describe, expect, it } from 'vitest';
import { calculateNextRunAt } from '../../src/modules/agendas/agenda.service';

describe('calculateNextRunAt', () => {
  // Reference: Wednesday 2026-04-08 at 10:30 (day=3, hour=10)
  const now = new Date('2026-04-08T10:30:00.000');

  it('returns same day when target hour is still ahead today', () => {
    // Target: Wednesday at 18h → same day
    const result = calculateNextRunAt(3, 18, now);
    expect(result.getDay()).toBe(3);
    expect(result.getHours()).toBe(18);
    expect(result.getDate()).toBe(8);
  });

  it('schedules 7 days ahead when target is same day but hour already passed', () => {
    // Target: Wednesday at 06h → already passed, next Wednesday
    const result = calculateNextRunAt(3, 6, now);
    expect(result.getDay()).toBe(3);
    expect(result.getDate()).toBe(15); // 8 + 7
  });

  it('schedules next occurrence when target day is in the future this week', () => {
    // Target: Friday (5) → 2 days ahead
    const result = calculateNextRunAt(5, 6, now);
    expect(result.getDay()).toBe(5);
    expect(result.getDate()).toBe(10);
  });

  it('wraps to next week when target day already passed this week', () => {
    // Target: Monday (1) → 5 days ahead (next Monday)
    const result = calculateNextRunAt(1, 6, now);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(13);
  });

  it('returns exact hour with zeroed minutes/seconds', () => {
    const result = calculateNextRunAt(5, 14, now);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('handles Sunday (0) correctly', () => {
    const result = calculateNextRunAt(0, 8, now);
    expect(result.getDay()).toBe(0);
  });
});

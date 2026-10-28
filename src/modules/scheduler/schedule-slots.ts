import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A missed slot (server down, another sync running) is still run if it is at most this old. */
export const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface WeeklySchedule {
  /** 0=Sun .. 6=Sat */
  days: number[];
  /** "HH:MM" wall-clock times in `timeZone` */
  times: string[];
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Every slot of the schedule from one week before `around` to one week after,
 * as UTC instants, sorted. Each wall-clock time is resolved in `timeZone`, so a
 * 08:00 slot stays 08:00 local across DST changes.
 */
export function listSlots(schedule: WeeklySchedule, timeZone: string, around: Date): Date[] {
  const days = new Set(schedule.days);
  const times = schedule.times.filter((time) => TIME_PATTERN.test(time));
  if (days.size === 0 || times.length === 0) return [];

  // Noon UTC of the local calendar day: stepping whole days from it never
  // crosses a date boundary, whatever the zone offset.
  const localToday = new Date(`${formatInTimeZone(around, timeZone, 'yyyy-MM-dd')}T12:00:00Z`);
  const slots: Date[] = [];

  for (let offset = -7; offset <= 7; offset += 1) {
    const day = new Date(localToday.getTime() + offset * DAY_MS);
    if (!days.has(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0, 10);
    for (const time of times) {
      slots.push(fromZonedTime(`${date}T${time}:00`, timeZone));
    }
  }

  return slots.sort((left, right) => left.getTime() - right.getTime());
}

export function getPreviousSlot(schedule: WeeklySchedule, timeZone: string, now: Date): Date | null {
  const past = listSlots(schedule, timeZone, now).filter((slot) => slot.getTime() <= now.getTime());
  return past[past.length - 1] ?? null;
}

export function getNextSlot(schedule: WeeklySchedule, timeZone: string, now: Date): Date | null {
  return listSlots(schedule, timeZone, now).find((slot) => slot.getTime() > now.getTime()) ?? null;
}

/**
 * The slot that should run now, or null. Only the most recent slot is ever
 * considered, so a long outage triggers one catch-up run, not a backlog.
 */
export function getDueSlot(
  schedule: WeeklySchedule,
  timeZone: string,
  lastSlotAt: Date | null,
  now: Date,
): Date | null {
  const previous = getPreviousSlot(schedule, timeZone, now);
  if (!previous) return null;
  if (lastSlotAt && previous.getTime() <= lastSlotAt.getTime()) return null;
  if (now.getTime() - previous.getTime() > CATCH_UP_WINDOW_MS) return null;
  return previous;
}

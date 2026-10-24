import { addDays, endOfDay, startOfDay } from 'date-fns';

export function getRangeFromOffsets(lookbackDays: number, futureDays: number) {
  const now = new Date();

  return {
    start: startOfDay(addDays(now, -lookbackDays)),
    end: endOfDay(addDays(now, futureDays)),
  };
}

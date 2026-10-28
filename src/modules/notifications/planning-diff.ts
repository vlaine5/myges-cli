/** The fields of an event that matter to someone reading their timetable. */
export interface PlanningEvent {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  room: string | null;
  campus: string | null;
  teacher: string | null;
  modality: string | null;
}

export type PlanningField = 'title' | 'startAt' | 'endAt' | 'room' | 'campus' | 'teacher' | 'modality';

const COMPARED_FIELDS: PlanningField[] = ['title', 'startAt', 'endAt', 'room', 'campus', 'teacher', 'modality'];

export interface PlanningUpdate {
  before: PlanningEvent;
  after: PlanningEvent;
  changedFields: PlanningField[];
}

export interface PlanningDiff {
  added: PlanningEvent[];
  updated: PlanningUpdate[];
  removed: PlanningEvent[];
}

function fieldValue(event: PlanningEvent, field: PlanningField) {
  const value = event[field];
  if (value instanceof Date) return value.getTime();
  return value?.trim() || null;
}

function changedFields(before: PlanningEvent, after: PlanningEvent) {
  return COMPARED_FIELDS.filter((field) => fieldValue(before, field) !== fieldValue(after, field));
}

function fingerprint(event: PlanningEvent, fields: PlanningField[]) {
  return JSON.stringify(fields.map((field) => fieldValue(event, field)));
}

/**
 * Pairs a removed event with an added one sharing the same values for
 * `fields`: the same course under a new id (e.g. after switching a provider
 * between ICS and API), not a cancellation plus a new course.
 */
function pairByFields(removed: PlanningEvent[], added: PlanningEvent[], fields: PlanningField[]) {
  const addedByKey = new Map<string, PlanningEvent[]>();
  for (const event of added) {
    const key = fingerprint(event, fields);
    addedByKey.set(key, [...(addedByKey.get(key) ?? []), event]);
  }

  const pairs: Array<[PlanningEvent, PlanningEvent]> = [];
  const unpairedRemoved: PlanningEvent[] = [];
  for (const event of removed) {
    const match = addedByKey.get(fingerprint(event, fields))?.shift();
    if (match) pairs.push([event, match]);
    else unpairedRemoved.push(event);
  }

  const paired = new Set(pairs.map(([, after]) => after));
  return { pairs, removed: unpairedRemoved, added: added.filter((event) => !paired.has(event)) };
}

/**
 * Compares the planning before and after a refresh. Events are matched by id;
 * an id that changed while the course stayed the same is not reported, and one
 * that changed along with its room or teacher (same title and times) is
 * reported as an update of the fields both versions fill in. Only changes touching [now, horizonEnd] are kept: a
 * course entering the fetch window weeks ahead is not news.
 */
export function diffPlanning(
  before: PlanningEvent[],
  after: PlanningEvent[],
  window: { now: Date; horizonEnd: Date },
): PlanningDiff {
  const beforeById = new Map(before.map((event) => [event.id, event]));
  const afterById = new Map(after.map((event) => [event.id, event]));

  const updated: PlanningUpdate[] = [];
  for (const [id, previous] of beforeById) {
    const current = afterById.get(id);
    if (!current) continue;
    const fields = changedFields(previous, current);
    if (fields.length > 0) updated.push({ before: previous, after: current, changedFields: fields });
  }

  const sameCourse = pairByFields(
    before.filter((event) => !afterById.has(event.id)),
    after.filter((event) => !beforeById.has(event.id)),
    COMPARED_FIELDS,
  );
  const sameSlot = pairByFields(sameCourse.removed, sameCourse.added, ['title', 'startAt', 'endAt']);
  for (const [previous, current] of sameSlot.pairs) {
    // A new id usually means a new source (ICS vs API), and one source may
    // not provide a field the other did: only a value replaced by another
    // value is a change.
    const fields = changedFields(previous, current).filter(
      (field) => fieldValue(previous, field) !== null && fieldValue(current, field) !== null,
    );
    if (fields.length > 0) updated.push({ before: previous, after: current, changedFields: fields });
  }

  const inWindow = (event: PlanningEvent) =>
    event.endAt.getTime() > window.now.getTime() && event.startAt.getTime() <= window.horizonEnd.getTime();
  const byStart = (left: PlanningEvent, right: PlanningEvent) => left.startAt.getTime() - right.startAt.getTime();

  return {
    added: sameSlot.added.filter(inWindow).sort(byStart),
    updated: updated
      .filter((update) => inWindow(update.before) || inWindow(update.after))
      .sort((left, right) => byStart(left.after, right.after)),
    removed: sameSlot.removed.filter(inWindow).sort(byStart),
  };
}

export function countChanges(diff: PlanningDiff) {
  return diff.added.length + diff.updated.length + diff.removed.length;
}

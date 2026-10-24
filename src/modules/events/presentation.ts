import type { EventDto, NormalizedEvent } from './types';

type EventLike = Pick<
  NormalizedEvent | EventDto,
  | 'id'
  | 'provider'
  | 'title'
  | 'subject'
  | 'startAt'
  | 'endAt'
  | 'teacher'
  | 'room'
  | 'promotion'
  | 'group'
  | 'classes'
  | 'studentCount'
  | 'disciplineName'
  | 'modality'
>;

function normalizeText(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toTimestamp(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function getSubjectLabel(event: EventLike) {
  return event.disciplineName ?? event.subject ?? event.title;
}

function getClasses(event: EventLike) {
  return Array.isArray(event.classes) ? event.classes.filter(Boolean) : [];
}

function buildTokenSet(event: EventLike) {
  return new Set(
    [event.title, event.subject, event.disciplineName]
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );
}

function sharesAnyToken(left: EventLike, right: EventLike) {
  const leftTokens = buildTokenSet(left);
  const rightTokens = buildTokenSet(right);

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true;
    }
  }

  return false;
}

export function getCompletenessScore(event: EventLike) {
  return (
    (event.teacher ? 3 : 0) +
    (event.room ? 2 : 0) +
    (event.promotion ? 2 : 0) +
    (event.group ? 2 : 0) +
    getClasses(event).length * 3 +
    (event.studentCount !== null ? 2 : 0) +
    (event.modality ? 1 : 0) +
    (event.subject && normalizeText(event.subject) !== normalizeText(event.title) ? 2 : 0) +
    (event.disciplineName && normalizeText(event.disciplineName) !== normalizeText(event.title)
      ? 1
      : 0)
  );
}

// Noise keywords that identify non-teaching events (holidays, vacations, administrative).
// Applied across all providers — a holiday from any calendar is still noise.
const NOISE_KEYWORDS = [
  'ferie',
  'jour ferie',
  'vacances',
  'conge',
  'toussaint',
  'ascension',
  'pentecote',
  'assomption',
  'armistice',
  'liberation',
  'noel',
  'paques',
] as const;

export function shouldExcludeEvent(event: EventLike) {
  const keywordSource = normalizeText(
    [event.title, event.subject, event.disciplineName].filter(Boolean).join(' '),
  );

  const hasNoiseKeyword = NOISE_KEYWORDS.some((kw) => keywordSource.includes(kw));

  if (!hasNoiseKeyword) {
    return false;
  }

  // Only exclude if there is no teacher, no class, no group — a bare placeholder.
  // A real teaching session that happens to mention a holiday keeps the teacher field.
  return !event.teacher && getClasses(event).length === 0 && !event.group && !event.promotion;
}

export interface ProbableDuplicateOptions {
  /**
   * When true, skips the same-provider early-return so the fuzzy checks below
   * (time/title/room/teacher/classes) can also match events from different
   * providers. Used by the cross-provider reconciliation suggester — never by
   * collapseEquivalentEvents, which must stay same-provider-only.
   */
  crossProvider?: boolean;
}

export function areProbableDuplicateEvents(
  left: EventLike,
  right: EventLike,
  options: ProbableDuplicateOptions = {},
) {
  if (!options.crossProvider && left.provider !== right.provider) {
    return false;
  }

  if (toTimestamp(left.startAt) !== toTimestamp(right.startAt)) {
    return false;
  }

  if (toTimestamp(left.endAt) !== toTimestamp(right.endAt)) {
    return false;
  }

  if (!sharesAnyToken(left, right)) {
    return false;
  }

  const leftRoom = normalizeText(left.room);
  const rightRoom = normalizeText(right.room);

  if (leftRoom && rightRoom && leftRoom !== rightRoom) {
    return false;
  }

  const leftTeacher = normalizeText(left.teacher);
  const rightTeacher = normalizeText(right.teacher);

  if (leftTeacher && rightTeacher && leftTeacher !== rightTeacher) {
    return false;
  }

  const leftClasses = getClasses(left).map((value) => normalizeText(value));
  const rightClasses = getClasses(right).map((value) => normalizeText(value));

  if (
    leftClasses.length > 0 &&
    rightClasses.length > 0 &&
    !leftClasses.some((value) => rightClasses.includes(value))
  ) {
    return false;
  }

  const leftGroup = normalizeText(left.group);
  const rightGroup = normalizeText(right.group);

  if (leftGroup && rightGroup && leftGroup !== rightGroup && leftClasses.length === 0 && rightClasses.length === 0) {
    return false;
  }

  return true;
}

export function collapseEquivalentEvents<T extends EventLike>(events: T[]) {
  const filtered = events.filter((event) => !shouldExcludeEvent(event));
  const collapsed: T[] = [];

  for (const event of filtered) {
    const duplicateIndex = collapsed.findIndex((candidate) =>
      areProbableDuplicateEvents(candidate, event),
    );

    if (duplicateIndex === -1) {
      collapsed.push(event);
      continue;
    }

    const existing = collapsed[duplicateIndex];

    if (existing && getCompletenessScore(event) > getCompletenessScore(existing)) {
      collapsed[duplicateIndex] = event;
    }
  }

  return collapsed.sort((left, right) => toTimestamp(left.startAt) - toTimestamp(right.startAt));
}

export function getEventSubjectLabel(event: EventLike) {
  return getSubjectLabel(event);
}

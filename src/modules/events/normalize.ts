import type { EventSnapshot } from '@prisma/client';
import { CAMPUS_LOCATIONS } from '../../constants/campus';
import { sha256 } from '../../lib/hash';
import type {
  AcademicProviderId,
  AgendaEventPayload,
  EventDto,
  NormalizedEvent,
  NormalizedRoom,
} from './types';

function cleanString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, ' ').trim();

  return cleaned.length > 0 ? cleaned : null;
}

function toDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

function normalizeRooms(rooms: AgendaEventPayload['rooms']): NormalizedRoom[] {
  return (rooms ?? []).map((room) => {
    const campus = cleanString(room?.campus);

    return {
      name: cleanString(room?.name),
      floor: cleanString(room?.floor),
      campus,
      address: campus ? CAMPUS_LOCATIONS[campus] ?? null : null,
    };
  });
}

function buildSourceId(raw: AgendaEventPayload) {
  if (typeof raw.reservation_id === 'number') {
    return String(raw.reservation_id);
  }

  return sha256(
    JSON.stringify([
      cleanString(raw.name),
      raw.start_date,
      raw.end_date,
      cleanString(raw.teacher),
      cleanString(raw.discipline?.name ?? undefined),
    ]),
  );
}

function buildEventIdentity(provider: AcademicProviderId, sourceId: string) {
  return `${provider}:${sourceId}`;
}

function buildSourceHash(event: Omit<NormalizedEvent, 'sourceHash'>) {
  return sha256(
    JSON.stringify({
      provider: event.provider,
      sourceId: event.sourceId,
      reservationId: event.reservationId,
      title: event.title,
      subject: event.subject,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      teacher: event.teacher,
      room: event.room,
      campus: event.campus,
      rooms: event.rooms,
      promotion: event.promotion,
      group: event.group,
      classes: event.classes,
      modality: event.modality,
      reservationType: event.reservationType,
      studentCount: event.studentCount,
      disciplineName: event.disciplineName,
      disciplineTeacher: event.disciplineTeacher,
      disciplineId: event.disciplineId,
    }),
  );
}

export function buildNormalizedEvent(
  event: Omit<NormalizedEvent, 'id' | 'sourceHash' | 'startAt' | 'endAt'> & {
    startAt: Date | string | number;
    endAt: Date | string | number;
  },
): NormalizedEvent {
  const eventWithoutHash: Omit<NormalizedEvent, 'sourceHash'> = {
    ...event,
    id: buildEventIdentity(event.provider, event.sourceId),
    startAt: toDate(event.startAt),
    endAt: toDate(event.endAt),
  };

  return {
    ...eventWithoutHash,
    sourceHash: buildSourceHash(eventWithoutHash),
  };
}

export function normalizeAgendaEvent(
  raw: AgendaEventPayload,
  providerOrOptions: AcademicProviderId | { includeRawPayload?: boolean } = 'myges',
  options: { includeRawPayload?: boolean } = {},
): NormalizedEvent {
  const provider =
    typeof providerOrOptions === 'string' ? providerOrOptions : 'myges';
  const resolvedOptions =
    typeof providerOrOptions === 'string' ? options : providerOrOptions;
  const rooms = normalizeRooms(raw.rooms);
  const room = rooms.map((entry) => entry.name).filter(Boolean).join(' / ') || null;
  const campus =
    [...new Set(rooms.map((entry) => entry.campus).filter(Boolean))].join(' / ') || null;
  const classes = (raw.classes ?? [])
    .map((value) => cleanString(value))
    .filter((value): value is string => Boolean(value));

  const sourceId = buildSourceId(raw);
  return buildNormalizedEvent({
    provider,
    sourceId,
    reservationId: typeof raw.reservation_id === 'number' ? raw.reservation_id : null,
    title: cleanString(raw.name) ?? 'Cours',
    subject: cleanString(raw.discipline?.name ?? undefined) ?? cleanString(raw.name),
    startAt: new Date(raw.start_date),
    endAt: new Date(raw.end_date),
    teacher:
      cleanString(raw.teacher) ??
      cleanString(raw.discipline?.teacher ?? undefined) ??
      null,
    room,
    campus,
    rooms,
    promotion: cleanString(raw.promotion),
    group:
      cleanString(raw.discipline?.student_group_name ?? undefined) ??
      classes[0] ??
      null,
    classes,
    modality: cleanString(raw.modality),
    reservationType: cleanString(raw.type),
    studentCount:
      typeof raw.discipline?.nb_students === 'number' ? raw.discipline.nb_students : null,
    disciplineName: cleanString(raw.discipline?.name ?? undefined),
    disciplineTeacher: cleanString(raw.discipline?.teacher ?? undefined),
    disciplineId: typeof raw.discipline?.rc_id === 'number' ? raw.discipline.rc_id : null,
    rawPayload: resolvedOptions.includeRawPayload ? JSON.stringify(raw) : null,
  });
}

export function dedupeEvents(events: NormalizedEvent[]) {
  const byId = new Map<string, NormalizedEvent>();

  for (const event of events) {
    const previous = byId.get(event.id);

    if (!previous) {
      byId.set(event.id, event);
      continue;
    }

    if (!previous.rawPayload && event.rawPayload) {
      byId.set(event.id, event);
    }
  }

  return [...byId.values()].sort(
    (left, right) => left.startAt.getTime() - right.startAt.getTime(),
  );
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Converts a persisted EventSnapshot back into a NormalizedEvent (Date objects,
 * not ISO strings) — used by the sync engine to build the Google payload from a
 * GlobalEvent's primary snapshot, which may belong to a different provider than
 * the one currently being synced.
 */
export function snapshotToNormalizedEvent(snapshot: EventSnapshot): NormalizedEvent {
  return {
    id: snapshot.id,
    provider: snapshot.provider as AcademicProviderId,
    sourceId: snapshot.sourceId,
    reservationId: snapshot.reservationId,
    title: snapshot.title,
    subject: snapshot.subject,
    startAt: snapshot.startAt,
    endAt: snapshot.endAt,
    teacher: snapshot.teacher,
    room: snapshot.room,
    campus: snapshot.campus,
    rooms: parseJson<NormalizedRoom[]>(snapshot.roomsJson, []),
    promotion: snapshot.promotion,
    group: snapshot.groupName,
    classes: parseJson<string[]>(snapshot.classesJson, []),
    modality: snapshot.modality,
    reservationType: snapshot.reservationType,
    studentCount: snapshot.studentCount,
    disciplineName: snapshot.disciplineName,
    disciplineTeacher: snapshot.disciplineTeacher,
    disciplineId: snapshot.disciplineId,
    rawPayload: snapshot.rawPayload,
    sourceHash: snapshot.sourceHash,
  };
}

export function snapshotToEventDto(snapshot: EventSnapshot, includeRawPayload = false): EventDto {
  return {
    id: snapshot.id,
    provider: snapshot.provider as AcademicProviderId,
    agendaId: (snapshot as EventSnapshot & { agendaId?: string | null }).agendaId ?? null,
    sourceId: snapshot.sourceId,
    reservationId: snapshot.reservationId,
    title: snapshot.title,
    subject: snapshot.subject,
    startAt: snapshot.startAt.toISOString(),
    endAt: snapshot.endAt.toISOString(),
    teacher: snapshot.teacher,
    room: snapshot.room,
    campus: snapshot.campus,
    rooms: parseJson<NormalizedRoom[]>(snapshot.roomsJson, []),
    promotion: snapshot.promotion,
    group: snapshot.groupName,
    classes: parseJson<string[]>(snapshot.classesJson, []),
    modality: snapshot.modality,
    reservationType: snapshot.reservationType,
    studentCount: snapshot.studentCount,
    disciplineName: snapshot.disciplineName,
    disciplineTeacher: snapshot.disciplineTeacher,
    disciplineId: snapshot.disciplineId,
    rawPayload: includeRawPayload ? parseJson(snapshot.rawPayload, null) : null,
    sourceHash: snapshot.sourceHash,
    updatedAt: snapshot.updatedAt.toISOString(),
    lastSeenAt: snapshot.lastSeenAt.toISOString(),
  };
}

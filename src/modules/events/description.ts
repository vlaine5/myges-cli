import type { EventDto, NormalizedEvent } from './types';

type EventLike = Pick<
  NormalizedEvent | EventDto,
  | 'title'
  | 'provider'
  | 'sourceId'
  | 'subject'
  | 'teacher'
  | 'room'
  | 'campus'
  | 'promotion'
  | 'group'
  | 'studentCount'
  | 'modality'
  | 'reservationId'
  | 'disciplineName'
  | 'classes'
>;

export function buildEventDescriptionLines(event: EventLike) {
  const lines = [
    `Cours: ${event.title}`,
    event.subject ? `Discipline: ${event.subject}` : null,
    event.teacher ? `Enseignant: ${event.teacher}` : null,
    event.room ? `Salle: ${event.room}` : null,
    event.campus ? `Campus: ${event.campus}` : null,
    event.promotion ? `Promotion: ${event.promotion}` : null,
    event.group ? `Groupe: ${event.group}` : null,
    event.classes.length > 0 ? `Classes: ${event.classes.join(', ')}` : null,
    event.modality ? `Modalite: ${event.modality}` : null,
    event.studentCount !== null ? `Nombre d'eleves: ${event.studentCount}` : null,
    event.reservationId !== null ? `Reservation ID: ${event.reservationId}` : null,
    `Source: ${event.provider}/${event.sourceId}`,
    event.disciplineName && event.disciplineName !== event.subject
      ? `Discipline brute: ${event.disciplineName}`
      : null,
  ];

  return lines.filter((line): line is string => Boolean(line));
}

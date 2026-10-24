export type AcademicProviderId = 'myges' | 'myefrei' | 'ensup' | 'generic';

export interface AgendaRoomPayload {
  room_id?: number | null;
  name?: string | null;
  floor?: string | null;
  campus?: string | null;
  color?: string | null;
  latitude?: string | null;
  longitude?: string | null;
}

export interface AgendaDisciplinePayload {
  name?: string | null;
  teacher?: string | null;
  nb_students?: number | null;
  rc_id?: number | null;
  student_group_name?: string | null;
}

export interface AgendaEventPayload {
  reservation_id?: number | null;
  rooms?: AgendaRoomPayload[] | null;
  type?: string | null;
  modality?: string | null;
  start_date: number;
  end_date: number;
  classes?: string[] | null;
  name?: string | null;
  discipline?: AgendaDisciplinePayload | null;
  teacher?: string | null;
  promotion?: string | null;
  [key: string]: unknown;
}

export interface NormalizedRoom {
  name: string | null;
  floor: string | null;
  campus: string | null;
  address: string | null;
}

export interface NormalizedEvent {
  id: string;
  provider: AcademicProviderId;
  sourceId: string;
  reservationId: number | null;
  title: string;
  subject: string | null;
  startAt: Date;
  endAt: Date;
  teacher: string | null;
  room: string | null;
  campus: string | null;
  rooms: NormalizedRoom[];
  promotion: string | null;
  group: string | null;
  classes: string[];
  modality: string | null;
  reservationType: string | null;
  studentCount: number | null;
  disciplineName: string | null;
  disciplineTeacher: string | null;
  disciplineId: number | null;
  rawPayload: string | null;
  sourceHash: string;
}

export interface EventDto {
  id: string;
  provider: AcademicProviderId;
  /** AgendaConfig.id that produced this event, or null for direct imports */
  agendaId: string | null;
  sourceId: string;
  reservationId: number | null;
  title: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  teacher: string | null;
  room: string | null;
  campus: string | null;
  rooms: NormalizedRoom[];
  promotion: string | null;
  group: string | null;
  classes: string[];
  modality: string | null;
  reservationType: string | null;
  studentCount: number | null;
  disciplineName: string | null;
  disciplineTeacher: string | null;
  disciplineId: number | null;
  rawPayload: unknown | null;
  sourceHash: string;
  updatedAt?: string;
  lastSeenAt?: string;
}

export interface RangeQuery {
  start: Date;
  end: Date;
}

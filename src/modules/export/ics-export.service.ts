import path from 'path';
import { writeFile } from 'fs/promises';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { ensureDirectory } from '../../lib/fs';
import { buildEventDescriptionLines } from '../events/description';
import type { AcademicProviderId, EventDto, NormalizedEvent, NormalizedRoom } from '../events/types';

type ExportableEvent = Pick<
  NormalizedEvent | EventDto,
  | 'id'
  | 'title'
  | 'startAt'
  | 'endAt'
  | 'rooms'
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
> & {
  rooms: NormalizedRoom[];
};

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatUtc(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function buildLocation(event: ExportableEvent) {
  const firstRoom = event.rooms[0];

  if (!firstRoom) {
    return '';
  }

  return [firstRoom.name, firstRoom.address].filter(Boolean).join(' - ');
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function renderEvent(event: ExportableEvent) {
  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcs(event.id)}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART:${formatUtc(toDate(event.startAt))}`,
    `DTEND:${formatUtc(toDate(event.endAt))}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(buildEventDescriptionLines(event).join('\n'))}`,
    buildLocation(event) ? `LOCATION:${escapeIcs(buildLocation(event))}` : null,
    'STATUS:CONFIRMED',
    'END:VEVENT',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\r\n');
}

export class IcsExportService {
  constructor(private readonly prisma: PrismaClient) {}

  async exportRange(
    providerId: AcademicProviderId,
    range: { start: Date; end: Date },
    events: ExportableEvent[],
    saveToDisk: boolean,
  ) {
    const content = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//myges-app//${providerId.toUpperCase()} Sync//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...events.map((event) => renderEvent(event)),
      'END:VCALENDAR',
      '',
    ].join('\r\n');

    let exportPath: string | null = null;

    if (saveToDisk) {
      const exportDirectory = path.join(env.dataDir, 'exports');
      await ensureDirectory(exportDirectory);
      exportPath = path.join(exportDirectory, 'latest.ics');
      await writeFile(exportPath, content, 'utf8');
      await this.prisma.icsExport.create({
        data: {
          provider: providerId,
          path: exportPath,
          eventCount: events.length,
          rangeStart: range.start,
          rangeEnd: range.end,
        },
      });
    }

    return {
      content,
      path: exportPath,
      eventCount: events.length,
    };
  }

  async getLastExport(providerId?: AcademicProviderId) {
    return this.prisma.icsExport.findFirst({
      where: providerId
        ? {
            provider: providerId,
          }
        : undefined,
      orderBy: {
        generatedAt: 'desc',
      },
    });
  }
}

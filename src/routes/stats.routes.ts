import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler, parseDateValue } from '../lib/http';
import { snapshotToEventDto } from '../modules/events/normalize';
import { collapseEquivalentEvents, getEventSubjectLabel } from '../modules/events/presentation';

const teachingQuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  provider: z.enum(['myges', 'myefrei', 'ensup']).optional(),
  subject: z.string().trim().min(1).optional(),
});

export function createStatsRouter(services: Services) {
  const router = Router();

  /**
   * GET /api/stats/teaching
   *
   * Returns aggregated teaching hours per class/group over a date range.
   * Used for annual "mon activité formation" declaration.
   *
   * Query params:
   *   start  — ISO date string (default: beginning of current year)
   *   end    — ISO date string (default: now)
   *   provider — filter by provider (optional)
   */
  router.get(
    '/teaching',
    asyncHandler(async (request, response) => {
      const query = teachingQuerySchema.parse(request.query);

      const now = new Date();
      const defaultStart = new Date(now.getFullYear(), 0, 1); // Jan 1st of current year
      const start = query.start ? parseDateValue(query.start, 'start') : defaultStart;
      const end = query.end ? parseDateValue(query.end, 'end') : now;

      const whereClause: Record<string, unknown> = {
        startAt: { gte: start, lte: end },
      };

      if (query.provider) {
        whereClause.provider = query.provider;
      }

      const snapshots = await services.prisma.eventSnapshot.findMany({
        where: whereClause,
        orderBy: { startAt: 'asc' },
      });

      const events = collapseEquivalentEvents(
        snapshots.map((snapshot) => snapshotToEventDto(snapshot)),
      );
      const availableSubjects = [...new Set(events.map((event) => getEventSubjectLabel(event)).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
      const normalizedSubjectFilter = query.subject?.trim().toLowerCase() ?? null;
      const filteredEvents = normalizedSubjectFilter
        ? events.filter(
            (event) => getEventSubjectLabel(event).trim().toLowerCase() === normalizedSubjectFilter,
          )
        : events;

      // Aggregate by (provider, class/group label, subject) — never merge different subjects.
      const aggregation = new Map<
        string,
        {
          key: string;
          provider: string;
          label: string;
          subject: string;
          studentCount: number | null;
          hours: number;
          sessionCount: number;
          firstSeen: Date;
          lastSeen: Date;
        }
      >();

      for (const event of filteredEvents) {
        const startAt = new Date(event.startAt);
        const endAt = new Date(event.endAt);
        const durationMs = endAt.getTime() - startAt.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        // Determine the class/group label(s)
        const classes = event.classes;

        const labels =
          classes.length > 0
            ? classes
            : event.promotion
              ? [event.promotion]
              : event.group
                ? [event.group]
                : ['(classe inconnue)'];

        const subject = getEventSubjectLabel(event);

        for (const label of labels) {
          // Key includes subject so different subjects for the same class are separate rows.
          const key = `${event.provider}::${label}::${subject}`;
          const existing = aggregation.get(key);

          if (existing) {
            existing.hours += durationHours;
            existing.sessionCount += 1;
            if (startAt < existing.firstSeen) {
              existing.firstSeen = startAt;
            }
            if (startAt > existing.lastSeen) {
              existing.lastSeen = startAt;
            }
            if (existing.studentCount === null && event.studentCount !== null) {
              existing.studentCount = event.studentCount;
            }
          } else {
            aggregation.set(key, {
              key,
              provider: event.provider,
              label,
              subject,
              studentCount: event.studentCount,
              hours: durationHours,
              sessionCount: 1,
              firstSeen: startAt,
              lastSeen: startAt,
            });
          }
        }
      }

      const rows = [...aggregation.values()]
        .sort(
          (a, b) =>
            a.provider.localeCompare(b.provider) ||
            a.label.localeCompare(b.label) ||
            a.subject.localeCompare(b.subject),
        )
        .map((row) => ({
          provider: row.provider,
          label: row.label,
          subject: row.subject,
          studentCount: row.studentCount,
          hours: Math.round(row.hours * 100) / 100,
          sessionCount: row.sessionCount,
          firstSeen: row.firstSeen.toISOString(),
          lastSeen: row.lastSeen.toISOString(),
        }));

      const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);

      response.json({
        period: { start: start.toISOString(), end: end.toISOString() },
        totalHours: Math.round(totalHours * 100) / 100,
        totalEvents: filteredEvents.length,
        availableSubjects,
        rows,
      });
    }),
  );

  return router;
}

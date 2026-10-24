import type { EventMatch, EventSnapshot, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import type { AcademicProviderId } from '../events/types';
import { snapshotToEventDto } from '../events/normalize';
import { areProbableDuplicateEvents, getCompletenessScore } from '../events/presentation';
import type { GoogleCalendarService } from '../google/google-calendar.service';

/** Window used to look for a cross-provider fuzzy match candidate. */
const FUZZY_MATCH_WINDOW_MS = 15 * 60 * 1000;

/** Window used when looking for a verified-identifier match across providers. */
const IDENTIFIER_MATCH_WINDOW_MS = 60 * 60 * 1000;

export type MatchStatus = 'AUTO_LINKED' | 'SUGGESTED' | 'AMBIGUOUS' | 'CONFIRMED' | 'REJECTED' | 'UNLINKED';
export type MatchBasis = 'VERIFIED_IDENTIFIER' | 'APPROVED_PRIOR_MATCH' | 'FUZZY_RESEMBLANCE';

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

/**
 * Time-independent identity fingerprint used to recognize a REPEAT occurrence of
 * a pair of classes that a human already confirmed as the same real class once
 * before (e.g. the same weekly session, one week later). Deliberately excludes
 * startAt/endAt/room — those vary week to week; teacher + subject/title + classes
 * do not.
 */
function buildFingerprint(snapshot: Pick<EventSnapshot, 'teacher' | 'subject' | 'title' | 'classesJson'>) {
  let classes: string[] = [];

  try {
    classes = JSON.parse(snapshot.classesJson ?? '[]');
  } catch {
    classes = [];
  }

  const sortedClasses = [...classes].map(normalizeText).sort().join('|');

  return [
    normalizeText(snapshot.teacher),
    normalizeText(snapshot.subject ?? snapshot.title),
    sortedClasses,
  ].join('::');
}

export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  /**
   * Entry point called after EventsService.refreshRange()'s upsert transaction
   * commits, for every snapshot id that was newly CREATED this run (not for
   * snapshots that merely changed content — those already belong to a
   * GlobalEvent and their membership is not re-evaluated on every sync).
   *
   * Each new snapshot was already inserted with its own solo GlobalEvent (the
   * EventSnapshot.globalEventId column is NOT NULL at the DB level, so that
   * assignment cannot be deferred past the insert). This method decides whether
   * that solo GlobalEvent should instead be merged into an existing one, based
   * ONLY on strong evidence (never on a bare resemblance).
   */
  async reconcileNewSnapshots(snapshotIds: string[]) {
    for (const snapshotId of snapshotIds) {
      try {
        await this.reconcileOneSnapshot(snapshotId);
      } catch (error) {
        logger.error({ err: error, snapshotId }, 'Reconciliation failed for snapshot.');
      }
    }
  }

  private async reconcileOneSnapshot(snapshotId: string) {
    const snapshot = await this.prisma.eventSnapshot.findUnique({ where: { id: snapshotId } });

    if (!snapshot) {
      return;
    }

    // Strong evidence #1: a prior CONFIRMED match for this exact teacher/subject/
    // classes fingerprint, from another provider, that a human already approved.
    const priorConfirmed = await this.findApprovedPriorMatch(snapshot);

    if (priorConfirmed) {
      await this.autoLink(snapshot, priorConfirmed.globalEventId, 'APPROVED_PRIOR_MATCH', {
        matchedSnapshotId: priorConfirmed.matchedSnapshotId,
      });
      return;
    }

    // Strong evidence #2: a verified shared identifier on a near-time snapshot
    // from another provider. Given today's providers have no shared identifier
    // format, this will rarely fire in practice — it exists so a future provider
    // (or an ICS import that embeds a native id) can use it.
    const verifiedIdentifier = await this.findVerifiedIdentifierMatch(snapshot);

    if (verifiedIdentifier) {
      await this.autoLink(snapshot, verifiedIdentifier.globalEventId, 'VERIFIED_IDENTIFIER', {
        matchedSnapshotId: verifiedIdentifier.snapshotId,
      });
      return;
    }

    // No strong evidence: run the fuzzy cross-provider matcher purely to
    // *suggest* candidates. Never auto-merge on this basis.
    await this.suggestFuzzyCandidates(snapshot);
  }

  /**
   * A GlobalEvent that a human has confirmed a cross-provider merge into (ever,
   * and not since reversed) is a trusted pairing: ALL of its currently-linked
   * snapshots' fingerprints — not just the one snapshot named on the CONFIRMED
   * row — become reference points for auto-linking a REPEAT occurrence from a
   * provider not yet represented in it (e.g. next week's class). This is what
   * makes the match symmetric: whichever provider's snapshot arrives first for
   * week 2 finds the other side's confirmed, trusted GlobalEvent.
   */
  private async findApprovedPriorMatch(snapshot: EventSnapshot) {
    const fingerprint = buildFingerprint(snapshot);

    if (!fingerprint.replace(/:|\|/g, '').trim()) {
      // Nothing usable to fingerprint on (no teacher, no subject/title worth
      // matching on) — skip rather than risk a false positive.
      return null;
    }

    const confirmedMatches = await this.prisma.eventMatch.findMany({
      where: { status: 'CONFIRMED' },
    });

    const trustedGlobalEventIds = new Set<string>();

    for (const match of confirmedMatches) {
      if (!(await this.isSuperseded(match))) {
        trustedGlobalEventIds.add(match.globalEventId);
      }
    }

    if (trustedGlobalEventIds.size === 0) {
      return null;
    }

    const candidateSnapshots = await this.prisma.eventSnapshot.findMany({
      where: {
        globalEventId: { in: [...trustedGlobalEventIds] },
        provider: { not: snapshot.provider },
      },
    });

    const match = candidateSnapshots.find((candidate) => buildFingerprint(candidate) === fingerprint);

    return match ? { globalEventId: match.globalEventId, matchedSnapshotId: match.id } : null;
  }

  /** True if a later REJECTED/UNLINKED row exists for the same (globalEventId, snapshotId) pair. */
  private async isSuperseded(match: EventMatch) {
    const laterOverride = await this.prisma.eventMatch.findFirst({
      where: {
        globalEventId: match.globalEventId,
        snapshotId: match.snapshotId,
        status: { in: ['REJECTED', 'UNLINKED'] },
        decidedAt: { gt: match.decidedAt },
      },
    });

    return Boolean(laterOverride);
  }

  private async findVerifiedIdentifierMatch(snapshot: EventSnapshot) {
    if (snapshot.reservationId === null && !snapshot.sourceId) {
      return null;
    }

    const windowStart = new Date(snapshot.startAt.getTime() - IDENTIFIER_MATCH_WINDOW_MS);
    const windowEnd = new Date(snapshot.startAt.getTime() + IDENTIFIER_MATCH_WINDOW_MS);

    const identifierFilters: Prisma.EventSnapshotWhereInput[] = [{ sourceId: snapshot.sourceId }];

    if (snapshot.reservationId !== null) {
      identifierFilters.push({ reservationId: snapshot.reservationId });
    }

    const candidates = await this.prisma.eventSnapshot.findMany({
      where: {
        provider: { not: snapshot.provider },
        startAt: { gte: windowStart, lte: windowEnd },
        globalEvent: { retiredAt: null },
        OR: identifierFilters,
      },
    });

    const match = candidates.find(
      (candidate) =>
        (snapshot.reservationId !== null && candidate.reservationId === snapshot.reservationId) ||
        candidate.sourceId === snapshot.sourceId,
    );

    return match ? { globalEventId: match.globalEventId, snapshotId: match.id } : null;
  }

  private async suggestFuzzyCandidates(snapshot: EventSnapshot) {
    const windowStart = new Date(snapshot.startAt.getTime() - FUZZY_MATCH_WINDOW_MS);
    const windowEnd = new Date(snapshot.startAt.getTime() + FUZZY_MATCH_WINDOW_MS);

    const candidateGlobalEvents = await this.prisma.globalEvent.findMany({
      where: {
        retiredAt: null,
        id: { not: snapshot.globalEventId },
        startAt: { gte: windowStart, lte: windowEnd },
      },
      include: {
        snapshots: { select: { provider: true } },
      },
    });

    const snapshotDto = snapshotToEventDto(snapshot);
    const matches: Array<{ globalEventId: string }> = [];

    for (const candidate of candidateGlobalEvents) {
      // Only consider genuinely cross-provider candidates — a GlobalEvent that
      // already has a snapshot from this same provider is not a fuzzy-merge
      // target (same-provider duplicates are handled at ingestion time).
      if (candidate.snapshots.some((linked) => linked.provider === snapshot.provider)) {
        continue;
      }

      if (!candidate.primarySnapshotId) {
        continue;
      }

      const primarySnapshot = await this.prisma.eventSnapshot.findUnique({
        where: { id: candidate.primarySnapshotId },
      });

      if (!primarySnapshot) {
        continue;
      }

      const primaryDto = snapshotToEventDto(primarySnapshot);

      if (areProbableDuplicateEvents(snapshotDto, primaryDto, { crossProvider: true })) {
        matches.push({ globalEventId: candidate.id });
      }
    }

    if (matches.length === 0) {
      return;
    }

    const status: MatchStatus = matches.length === 1 ? 'SUGGESTED' : 'AMBIGUOUS';

    await this.prisma.$transaction(
      matches.map((match) =>
        this.prisma.eventMatch.create({
          data: {
            globalEventId: match.globalEventId,
            snapshotId: snapshot.id,
            status,
            matchBasis: 'FUZZY_RESEMBLANCE',
            confidence: null,
            reasonJson: JSON.stringify({
              reason:
                status === 'SUGGESTED'
                  ? 'Single cross-provider fuzzy candidate within the time window.'
                  : 'Multiple close cross-provider fuzzy candidates within the time window.',
              candidateCount: matches.length,
            }),
            decidedBy: 'system:reconciliation',
          },
        }),
      ),
    );
  }

  private async autoLink(
    snapshot: EventSnapshot,
    targetGlobalEventId: string,
    matchBasis: MatchBasis,
    reason: Record<string, unknown>,
  ) {
    const soloGlobalEventId = snapshot.globalEventId;

    await this.prisma.$transaction(async (tx) => {
      await tx.eventMatch.create({
        data: {
          globalEventId: targetGlobalEventId,
          snapshotId: snapshot.id,
          status: 'AUTO_LINKED',
          matchBasis,
          confidence: 1,
          reasonJson: JSON.stringify(reason),
          decidedBy: 'system:reconciliation',
        },
      });

      await tx.eventSnapshot.update({
        where: { id: snapshot.id },
        data: { globalEventId: targetGlobalEventId },
      });

      const remaining = await tx.eventSnapshot.count({ where: { globalEventId: soloGlobalEventId } });

      if (remaining === 0 && soloGlobalEventId !== targetGlobalEventId) {
        await this.retireAndReconcileMapping(tx, soloGlobalEventId, targetGlobalEventId);
      }
    });

    logger.info(
      { snapshotId: snapshot.id, targetGlobalEventId, matchBasis },
      'Auto-linked snapshot to an existing GlobalEvent.',
    );
  }

  /**
   * Called whenever a solo GlobalEvent becomes empty because its only snapshot
   * was just reassigned elsewhere. Retires it, and — if it was carrying a live
   * Google mapping — either migrates that mapping onto the target (when the
   * target has none yet) or deletes the now-redundant Google event (when the
   * target already has its own live mapping), per the no-duplicate-events rule.
   */
  private async retireAndReconcileMapping(
    tx: Prisma.TransactionClient,
    emptyGlobalEventId: string,
    targetGlobalEventId: string,
  ) {
    await tx.globalEvent.update({
      where: { id: emptyGlobalEventId },
      // Clearing primarySnapshotId releases its unique slot — otherwise a
      // snapshot that was ever a primary could never become a primary again
      // anywhere else, even after its GlobalEvent is retired and empty.
      data: { retiredAt: new Date(), primarySnapshotId: null },
    });

    const emptyMapping = await tx.eventMapping.findUnique({ where: { globalEventId: emptyGlobalEventId } });

    if (!emptyMapping) {
      return;
    }

    const targetMapping = await tx.eventMapping.findUnique({ where: { globalEventId: targetGlobalEventId } });

    if (!targetMapping) {
      // Target has no mapping yet: keep the already-synced Google event by
      // repointing the mapping instead of discarding it.
      await tx.eventMapping.update({
        where: { id: emptyMapping.id },
        data: { globalEventId: targetGlobalEventId },
      });
      return;
    }

    // Both have a live mapping: Google must not end up with two entries for the
    // same real class. Delete the now-redundant one.
    if (emptyMapping.googleEventId) {
      try {
        const calendarId = await this.googleCalendarService.getConfiguredCalendarId(
          emptyMapping.provider as AcademicProviderId,
        );
        await this.googleCalendarService.deleteEvent(calendarId, emptyMapping.googleEventId);
      } catch (error) {
        logger.error(
          { err: error, mappingId: emptyMapping.id },
          'Failed to delete redundant Google event while merging GlobalEvents.',
        );
      }
    }

    await tx.eventMapping.delete({ where: { id: emptyMapping.id } });
  }

  /** List pending (not yet decided) SUGGESTED/AMBIGUOUS matches, optionally filtered by provider. */
  async listSuggestions(options: { provider?: AcademicProviderId } = {}) {
    const candidates = await this.prisma.eventMatch.findMany({
      where: { status: { in: ['SUGGESTED', 'AMBIGUOUS'] } },
      orderBy: { decidedAt: 'desc' },
      include: {
        snapshot: true,
        globalEvent: true,
      },
    });

    const pending: typeof candidates = [];

    for (const candidate of candidates) {
      if (await this.isSuperseded(candidate)) {
        continue;
      }

      if (options.provider && candidate.snapshot.provider !== options.provider) {
        continue;
      }

      pending.push(candidate);
    }

    return pending;
  }

  async getMatchOrThrow(matchId: string) {
    const match = await this.prisma.eventMatch.findUnique({ where: { id: matchId } });

    if (!match) {
      throw new AppError('Reconciliation suggestion not found.', 404, 'MATCH_NOT_FOUND');
    }

    return match;
  }

  /** Confirm a SUGGESTED/AMBIGUOUS match: merges the snapshot into the suggested GlobalEvent. */
  async confirmMatch(matchId: string, decidedBy: string) {
    const match = await this.getMatchOrThrow(matchId);
    const snapshot = await this.prisma.eventSnapshot.findUniqueOrThrow({ where: { id: match.snapshotId } });
    const soloGlobalEventId = snapshot.globalEventId;

    await this.prisma.$transaction(async (tx) => {
      await tx.eventMatch.create({
        data: {
          globalEventId: match.globalEventId,
          snapshotId: match.snapshotId,
          status: 'CONFIRMED',
          matchBasis: match.matchBasis,
          confidence: match.confidence,
          reasonJson: JSON.stringify({ confirms: match.id }),
          decidedBy,
        },
      });

      if (soloGlobalEventId === match.globalEventId) {
        // Already linked (e.g. confirming a stale suggestion) — nothing to move.
        return;
      }

      await tx.eventSnapshot.update({
        where: { id: snapshot.id },
        data: { globalEventId: match.globalEventId },
      });

      const remaining = await tx.eventSnapshot.count({ where: { globalEventId: soloGlobalEventId } });

      if (remaining === 0) {
        await this.retireAndReconcileMapping(tx, soloGlobalEventId, match.globalEventId);
      }
    });

    logger.info({ matchId, snapshotId: match.snapshotId, decidedBy }, 'Confirmed reconciliation match.');
  }

  /** Reject a SUGGESTED/AMBIGUOUS match: the snapshot stays solo (or keeps its current membership). */
  async rejectMatch(matchId: string, decidedBy: string) {
    const match = await this.getMatchOrThrow(matchId);

    await this.prisma.eventMatch.create({
      data: {
        globalEventId: match.globalEventId,
        snapshotId: match.snapshotId,
        status: 'REJECTED',
        matchBasis: match.matchBasis,
        confidence: match.confidence,
        reasonJson: JSON.stringify({ rejects: match.id }),
        decidedBy,
      },
    });

    logger.info({ matchId, decidedBy }, 'Rejected reconciliation match.');
  }

  /** Unlink a snapshot from its current GlobalEvent, restoring it to its own solo GlobalEvent. */
  async unlinkSnapshot(globalEventId: string, snapshotId: string, decidedBy: string) {
    const snapshot = await this.prisma.eventSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });

    if (snapshot.globalEventId !== globalEventId) {
      throw new AppError(
        'Snapshot is not currently linked to the given GlobalEvent.',
        409,
        'SNAPSHOT_NOT_LINKED',
      );
    }

    const previousBasis = await this.prisma.eventMatch.findFirst({
      where: { globalEventId, snapshotId },
      orderBy: { decidedAt: 'desc' },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.eventMatch.create({
        data: {
          globalEventId,
          snapshotId,
          status: 'UNLINKED',
          matchBasis: previousBasis?.matchBasis ?? 'FUZZY_RESEMBLANCE',
          reasonJson: JSON.stringify({ reason: 'Manually unlinked by user action.' }),
          decidedBy,
        },
      });

      const oldGlobalEvent = await tx.globalEvent.findUniqueOrThrow({ where: { id: globalEventId } });
      const wasPrimary = oldGlobalEvent.primarySnapshotId === snapshotId;

      if (wasPrimary) {
        // Free up the unique primarySnapshotId slot BEFORE creating the new solo
        // GlobalEvent below (which also uses snapshot.id as ITS primary) — both
        // cannot hold the same primarySnapshotId at once.
        await tx.globalEvent.update({ where: { id: globalEventId }, data: { primarySnapshotId: null } });
      }

      const newSolo = await tx.globalEvent.create({
        data: {
          title: snapshot.title,
          subject: snapshot.subject,
          startAt: snapshot.startAt,
          endAt: snapshot.endAt,
          teacher: snapshot.teacher,
          room: snapshot.room,
          campus: snapshot.campus,
          promotion: snapshot.promotion,
          groupName: snapshot.groupName,
          modality: snapshot.modality,
          primarySnapshotId: snapshot.id,
        },
      });

      await tx.eventSnapshot.update({
        where: { id: snapshot.id },
        data: { globalEventId: newSolo.id },
      });

      const remainingSnapshots = await tx.eventSnapshot.findMany({ where: { globalEventId } });

      if (remainingSnapshots.length === 0) {
        // Nothing left under the old GlobalEvent: migrate its mapping (if any)
        // onto the newly-created solo GlobalEvent instead of orphaning it, then
        // retire the now-empty old one.
        const oldMapping = await tx.eventMapping.findUnique({ where: { globalEventId } });

        if (oldMapping) {
          await tx.eventMapping.update({
            where: { id: oldMapping.id },
            data: { globalEventId: newSolo.id },
          });
        }

        await tx.globalEvent.update({
          where: { id: globalEventId },
          data: { retiredAt: new Date(), primarySnapshotId: null },
        });
        return;
      }

      if (wasPrimary) {
        // Promote the most complete remaining snapshot to replace the one that
        // just left.
        const ranked = remainingSnapshots
          .map((candidate) => ({ candidate, score: getCompletenessScore(snapshotToEventDto(candidate)) }))
          .sort((left, right) => right.score - left.score);
        const promoted = ranked[0]?.candidate;

        if (promoted) {
          await tx.globalEvent.update({
            where: { id: globalEventId },
            data: { primarySnapshotId: promoted.id },
          });
        }
      }
    });

    logger.info({ globalEventId, snapshotId, decidedBy }, 'Unlinked snapshot from GlobalEvent.');
  }

  async listGlobalEvents(options: { start?: Date; end?: Date } = {}) {
    return this.prisma.globalEvent.findMany({
      where: {
        retiredAt: null,
        ...(options.start && options.end
          ? { startAt: { gte: options.start, lte: options.end } }
          : {}),
      },
      orderBy: { startAt: 'asc' },
      include: { snapshots: true, mapping: true },
    });
  }

  async getGlobalEventById(id: string) {
    const globalEvent = await this.prisma.globalEvent.findUnique({
      where: { id },
      include: { snapshots: true, mapping: true, matches: true },
    });

    if (!globalEvent) {
      throw new AppError('GlobalEvent not found.', 404, 'GLOBAL_EVENT_NOT_FOUND');
    }

    return globalEvent;
  }
}

import type { EventEnrichmentRule, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/app-error';
import { buildNormalizedEvent } from '../events/normalize';
import type { AcademicProviderId, NormalizedEvent } from '../events/types';

export const enrichmentRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  matchProvider: z.enum(['myges', 'myefrei', 'ensup', 'generic']).optional().nullable(),
  matchClassLike: z.string().trim().max(200).optional().nullable(),
  matchSubjectLike: z.string().trim().max(200).optional().nullable(),
  matchRoomLike: z.string().trim().max(200).optional().nullable(),
  matchKeywords: z.array(z.string().trim().min(1)).max(20).optional().nullable(),
  injectProvider: z.enum(['myges', 'myefrei', 'ensup', 'generic']).optional().nullable(),
  injectClass: z.string().trim().max(200).optional().nullable(),
  injectSubject: z.string().trim().max(200).optional().nullable(),
  injectTeacher: z.string().trim().max(200).optional().nullable(),
  injectRoom: z.string().trim().max(200).optional().nullable(),
  injectCampus: z.string().trim().max(200).optional().nullable(),
  injectStudentCount: z.number().int().min(0).max(9999).optional().nullable(),
  injectModality: z.string().trim().max(100).optional().nullable(),
  priority: z.number().int().min(-100).max(100).default(0),
  enabled: z.boolean().default(true),
});

export type EnrichmentRuleInput = z.infer<typeof enrichmentRuleInputSchema>;

export interface EnrichmentRuleDto {
  id: string;
  name: string;
  matchProvider: string | null;
  matchClassLike: string | null;
  matchSubjectLike: string | null;
  matchRoomLike: string | null;
  matchKeywords: string[] | null;
  injectProvider: string | null;
  injectClass: string | null;
  injectSubject: string | null;
  injectTeacher: string | null;
  injectRoom: string | null;
  injectCampus: string | null;
  injectStudentCount: number | null;
  injectModality: string | null;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: EventEnrichmentRule): EnrichmentRuleDto {
  return {
    id: row.id,
    name: row.name,
    matchProvider: row.matchProvider,
    matchClassLike: row.matchClassLike,
    matchSubjectLike: row.matchSubjectLike,
    matchRoomLike: row.matchRoomLike,
    matchKeywords: row.matchKeywords ? (JSON.parse(row.matchKeywords) as string[]) : null,
    injectProvider: row.injectProvider,
    injectClass: row.injectClass,
    injectSubject: row.injectSubject,
    injectTeacher: row.injectTeacher,
    injectRoom: row.injectRoom,
    injectCampus: row.injectCampus,
    injectStudentCount: row.injectStudentCount,
    injectModality: row.injectModality,
    priority: row.priority,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class EnrichmentRuleService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<EnrichmentRuleDto[]> {
    const rows = await this.prisma.eventEnrichmentRule.findMany({
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async getById(id: string): Promise<EnrichmentRuleDto> {
    const row = await this.prisma.eventEnrichmentRule.findUnique({ where: { id } });
    if (!row) throw new AppError('Enrichment rule not found.', 404, 'ENRICHMENT_RULE_NOT_FOUND');
    return toDto(row);
  }

  async create(input: EnrichmentRuleInput): Promise<EnrichmentRuleDto> {
    const row = await this.prisma.eventEnrichmentRule.create({
      data: {
        name: input.name,
        matchProvider: input.matchProvider ?? null,
        matchClassLike: input.matchClassLike ?? null,
        matchSubjectLike: input.matchSubjectLike ?? null,
        matchRoomLike: input.matchRoomLike ?? null,
        matchKeywords: input.matchKeywords ? JSON.stringify(input.matchKeywords) : null,
        injectProvider: input.injectProvider ?? null,
        injectClass: input.injectClass ?? null,
        injectSubject: input.injectSubject ?? null,
        injectTeacher: input.injectTeacher ?? null,
        injectRoom: input.injectRoom ?? null,
        injectCampus: input.injectCampus ?? null,
        injectStudentCount: input.injectStudentCount ?? null,
        injectModality: input.injectModality ?? null,
        priority: input.priority,
        enabled: input.enabled,
      },
    });
    return toDto(row);
  }

  async update(id: string, input: EnrichmentRuleInput): Promise<EnrichmentRuleDto> {
    const existing = await this.prisma.eventEnrichmentRule.findUnique({ where: { id } });
    if (!existing) throw new AppError('Enrichment rule not found.', 404, 'ENRICHMENT_RULE_NOT_FOUND');

    const row = await this.prisma.eventEnrichmentRule.update({
      where: { id },
      data: {
        name: input.name,
        matchProvider: input.matchProvider ?? null,
        matchClassLike: input.matchClassLike ?? null,
        matchSubjectLike: input.matchSubjectLike ?? null,
        matchRoomLike: input.matchRoomLike ?? null,
        matchKeywords: input.matchKeywords ? JSON.stringify(input.matchKeywords) : null,
        injectProvider: input.injectProvider ?? null,
        injectClass: input.injectClass ?? null,
        injectSubject: input.injectSubject ?? null,
        injectTeacher: input.injectTeacher ?? null,
        injectRoom: input.injectRoom ?? null,
        injectCampus: input.injectCampus ?? null,
        injectStudentCount: input.injectStudentCount ?? null,
        injectModality: input.injectModality ?? null,
        priority: input.priority,
        enabled: input.enabled,
      },
    });
    return toDto(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.eventEnrichmentRule.findUnique({ where: { id } });
    if (!existing) throw new AppError('Enrichment rule not found.', 404, 'ENRICHMENT_RULE_NOT_FOUND');
    await this.prisma.eventEnrichmentRule.delete({ where: { id } });
  }
}

/**
 * Apply matching enrichment rules to a set of event fields.
 * Rules are applied in descending priority order; first match per field wins.
 *
 * The event fields here are the normalized ICS event preview fields (title, subject, etc.).
 */
export interface EnrichableFields {
  provider: string;
  classes: string[];
  subject: string | null;
  room: string | null;
  title: string | null;
  description: string | null;
}

export interface AppliedEnrichments {
  provider?: string;
  injectClass?: string;
  subject?: string;
  teacher?: string;
  room?: string;
  campus?: string;
  studentCount?: number;
  modality?: string;
  /** Human-readable list of rule names that matched */
  matchedRules: string[];
}

function ciIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function ruleMatchesEvent(rule: EnrichmentRuleDto, fields: EnrichableFields): boolean {
  if (rule.matchProvider && rule.matchProvider !== fields.provider) return false;

  if (rule.matchClassLike) {
    const anyClassMatches = fields.classes.some((c) =>
      ciIncludes(c, rule.matchClassLike!),
    );
    if (!anyClassMatches) return false;
  }

  if (rule.matchSubjectLike) {
    if (!ciIncludes(fields.subject, rule.matchSubjectLike) &&
        !ciIncludes(fields.title, rule.matchSubjectLike)) {
      return false;
    }
  }

  if (rule.matchRoomLike) {
    if (!ciIncludes(fields.room, rule.matchRoomLike)) return false;
  }

  if (rule.matchKeywords && rule.matchKeywords.length > 0) {
    const corpus = [fields.title, fields.subject, fields.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const allPresent = rule.matchKeywords.every((kw) =>
      corpus.includes(kw.toLowerCase()),
    );
    if (!allPresent) return false;
  }

  return true;
}

/**
 * Apply a sorted list of enrichment rules (highest priority first) to event fields.
 * Returns the set of injected values and which rules matched.
 */
export function applyEnrichmentRules(
  rules: EnrichmentRuleDto[],
  fields: EnrichableFields,
): AppliedEnrichments {
  const result: AppliedEnrichments = { matchedRules: [] };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatchesEvent(rule, fields)) continue;

    result.matchedRules.push(rule.name);

    // First match per field wins — don't overwrite already-injected values.
    if (rule.injectProvider && !result.provider) result.provider = rule.injectProvider;
    if (rule.injectClass && !result.injectClass) result.injectClass = rule.injectClass;
    if (rule.injectSubject && !result.subject) result.subject = rule.injectSubject;
    if (rule.injectTeacher && !result.teacher) result.teacher = rule.injectTeacher;
    if (rule.injectRoom && !result.room) result.room = rule.injectRoom;
    if (rule.injectCampus && !result.campus) result.campus = rule.injectCampus;
    if (rule.injectStudentCount != null && result.studentCount == null) {
      result.studentCount = rule.injectStudentCount;
    }
    if (rule.injectModality && !result.modality) result.modality = rule.injectModality;
  }

  return result;
}

/**
 * Apply a (pre-filtered-to-enabled) list of enrichment rules to a fully
 * normalized event, used by EventsService.refreshRange() right before
 * dedupe/upsert, for both the live-API and ICS fetch paths.
 *
 * Returns the same event unchanged (same object reference) when no rule
 * matched, and a freshly rebuilt NormalizedEvent (recomputed id/sourceHash)
 * otherwise, since injected fields may change the event's content.
 */
export function applyEnrichmentToEvent(
  event: NormalizedEvent,
  rules: EnrichmentRuleDto[],
): NormalizedEvent {
  const fields: EnrichableFields = {
    provider: event.provider,
    classes: event.classes,
    subject: event.subject,
    room: event.room,
    title: event.title,
    description: [event.subject, event.disciplineName].filter(Boolean).join(' '),
  };

  const applied = applyEnrichmentRules(rules, fields);
  if (applied.matchedRules.length === 0) {
    return event;
  }

  return buildNormalizedEvent({
    ...event,
    provider: (applied.provider as AcademicProviderId | undefined) ?? event.provider,
    subject: applied.subject ?? event.subject,
    teacher: applied.teacher ?? event.teacher,
    room: applied.room ?? event.room,
    campus: applied.campus ?? event.campus,
    classes: applied.injectClass ? [applied.injectClass] : event.classes,
    promotion: applied.injectClass ?? event.promotion,
    group: applied.injectClass ?? event.group,
    studentCount: applied.studentCount ?? event.studentCount,
    modality: applied.modality ?? event.modality,
  });
}

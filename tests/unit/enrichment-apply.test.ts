import { describe, expect, it } from 'vitest';
import {
  applyEnrichmentRules,
  applyEnrichmentToEvent,
  type EnrichableFields,
  type EnrichmentRuleDto,
} from '../../src/modules/enrichment/enrichment-rule.service';
import { buildNormalizedEvent } from '../../src/modules/events/normalize';

function makeRule(overrides: Partial<EnrichmentRuleDto> = {}): EnrichmentRuleDto {
  return {
    id: overrides.id ?? 'rule-1',
    name: overrides.name ?? 'Test rule',
    matchProvider: null,
    matchClassLike: null,
    matchSubjectLike: null,
    matchRoomLike: null,
    matchKeywords: null,
    injectProvider: null,
    injectClass: null,
    injectSubject: null,
    injectTeacher: null,
    injectRoom: null,
    injectCampus: null,
    injectStudentCount: null,
    injectModality: null,
    priority: 0,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFields(overrides: Partial<EnrichableFields> = {}): EnrichableFields {
  return {
    provider: 'myges',
    classes: ['L3 INFO'],
    subject: 'Algorithmique',
    room: 'B204',
    title: 'Cours algo',
    description: null,
    ...overrides,
  };
}

describe('applyEnrichmentRules — matching', () => {
  it('applies injectStudentCount only when matchClassLike substring-matches (case-insensitive)', () => {
    const rule = makeRule({ matchClassLike: 'l3 info', injectStudentCount: 35 });

    const matching = applyEnrichmentRules([rule], makeFields({ classes: ['Promo L3 INFO A'] }));
    expect(matching.studentCount).toBe(35);
    expect(matching.matchedRules).toEqual(['Test rule']);

    const nonMatching = applyEnrichmentRules([rule], makeFields({ classes: ['M1 DATA'] }));
    expect(nonMatching.studentCount).toBeUndefined();
    expect(nonMatching.matchedRules).toEqual([]);
  });

  it('never overwrites with a null inject field (only non-null fields override)', () => {
    const rule = makeRule({ matchClassLike: 'L3', injectStudentCount: 40, injectRoom: null });
    const applied = applyEnrichmentRules([rule], makeFields({ classes: ['L3 INFO'], room: 'B204' }));

    expect(applied.studentCount).toBe(40);
    expect(applied.room).toBeUndefined(); // rule's injectRoom is null -> never set

    const event = buildNormalizedEvent({
      provider: 'myges',
      sourceId: 's1',
      reservationId: null,
      title: 'Cours',
      subject: 'Algo',
      startAt: new Date('2026-01-01T08:00:00Z'),
      endAt: new Date('2026-01-01T10:00:00Z'),
      teacher: null,
      room: 'B204',
      campus: null,
      rooms: [],
      promotion: null,
      group: null,
      classes: ['L3 INFO'],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: null,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    const enriched = applyEnrichmentToEvent(event, [rule]);
    expect(enriched.studentCount).toBe(40);
    expect(enriched.room).toBe('B204'); // untouched — rule's injectRoom was null
  });

  it('matchProvider / matchSubjectLike / matchRoomLike / matchKeywords all apply (ANDed)', () => {
    const rule = makeRule({
      matchProvider: 'myefrei',
      matchSubjectLike: 'algo',
      matchRoomLike: 'b2',
      matchKeywords: ['TP', 'avance'],
      injectStudentCount: 20,
    });

    const matches = applyEnrichmentRules(
      [rule],
      makeFields({
        provider: 'myefrei',
        subject: 'Algorithmique avancee',
        room: 'B204',
        title: 'TP algo avance',
        description: null,
      }),
    );
    expect(matches.studentCount).toBe(20);

    // Wrong provider -> no match even if everything else matches.
    const wrongProvider = applyEnrichmentRules(
      [rule],
      makeFields({
        provider: 'myges',
        subject: 'Algorithmique avancee',
        room: 'B204',
        title: 'TP algo avance',
      }),
    );
    expect(wrongProvider.studentCount).toBeUndefined();

    // Missing one keyword -> no match.
    const missingKeyword = applyEnrichmentRules(
      [rule],
      makeFields({
        provider: 'myefrei',
        subject: 'Algorithmique avancee',
        room: 'B204',
        title: 'Cours algo',
      }),
    );
    expect(missingKeyword.studentCount).toBeUndefined();
  });
});

describe('applyEnrichmentRules — priority ordering', () => {
  it('resolves a conflict between two matching rules by letting the higher-priority rule win', () => {
    const lowPriority = makeRule({
      id: 'low',
      name: 'Low priority',
      matchClassLike: 'L3',
      injectStudentCount: 10,
      priority: -5,
    });
    const highPriority = makeRule({
      id: 'high',
      name: 'High priority',
      matchClassLike: 'L3',
      injectStudentCount: 99,
      priority: 5,
    });

    // Rules are expected to be passed in descending-priority order (as
    // EnrichmentRuleService.list() already returns them) — "first match per
    // field wins", so the higher-priority rule must come first.
    const applied = applyEnrichmentRules(
      [highPriority, lowPriority],
      makeFields({ classes: ['L3 INFO'] }),
    );

    expect(applied.studentCount).toBe(99);
    expect(applied.matchedRules).toEqual(['High priority', 'Low priority']);
  });

  it('skips disabled rules entirely', () => {
    const rule = makeRule({ matchClassLike: 'L3', injectStudentCount: 50, enabled: false });
    const applied = applyEnrichmentRules([rule], makeFields({ classes: ['L3 INFO'] }));
    expect(applied.studentCount).toBeUndefined();
    expect(applied.matchedRules).toEqual([]);
  });
});

describe('applyEnrichmentToEvent', () => {
  it('returns the same event reference when no rule matches', () => {
    const event = buildNormalizedEvent({
      provider: 'myges',
      sourceId: 's2',
      reservationId: null,
      title: 'Cours',
      subject: 'Reseaux',
      startAt: new Date('2026-01-02T08:00:00Z'),
      endAt: new Date('2026-01-02T10:00:00Z'),
      teacher: null,
      room: null,
      campus: null,
      rooms: [],
      promotion: null,
      group: null,
      classes: ['M1 DATA'],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: null,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    const rule = makeRule({ matchClassLike: 'L3 INFO', injectStudentCount: 40 });
    const result = applyEnrichmentToEvent(event, [rule]);
    expect(result).toBe(event);
  });

  it('recomputes sourceHash when a field is actually injected, so downstream change-detection sees it', () => {
    const event = buildNormalizedEvent({
      provider: 'myges',
      sourceId: 's3',
      reservationId: null,
      title: 'Cours',
      subject: 'Reseaux',
      startAt: new Date('2026-01-03T08:00:00Z'),
      endAt: new Date('2026-01-03T10:00:00Z'),
      teacher: null,
      room: null,
      campus: null,
      rooms: [],
      promotion: null,
      group: null,
      classes: ['L3 INFO'],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: null,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    const rule = makeRule({ matchClassLike: 'L3 INFO', injectStudentCount: 42 });
    const result = applyEnrichmentToEvent(event, [rule]);

    expect(result.studentCount).toBe(42);
    expect(result.id).toBe(event.id); // identity (provider+sourceId) unchanged
    expect(result.sourceHash).not.toBe(event.sourceHash);
  });
});

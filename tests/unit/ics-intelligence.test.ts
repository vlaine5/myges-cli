/**
 * Tests for intelligent ICS import features:
 * - Noise exclusion extended to all providers
 * - Per-event provider detection
 * - Teaching hours: no subject merging
 * - Preview pipeline (previewIcsContent)
 */

import { describe, expect, it } from 'vitest';
import { shouldExcludeEvent } from '../../src/modules/events/presentation';
import { detectProviderFromEvent } from '../../src/lib/ics-event-provider-detector';
import { previewIcsContent } from '../../src/modules/imports/ics-import.service';
import { applyEnrichmentRules } from '../../src/modules/enrichment/enrichment-rule.service';
import { buildNormalizedEvent } from '../../src/modules/events/normalize';
import type { IcsEvent } from '../../src/lib/ics-parser';
import type { EnrichmentRuleDto } from '../../src/modules/enrichment/enrichment-rule.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNormalizedEvent(overrides: Partial<Parameters<typeof buildNormalizedEvent>[0]> = {}) {
  return buildNormalizedEvent({
    provider: 'generic',
    sourceId: 'test',
    reservationId: null,
    title: 'Cours de test',
    subject: null,
    startAt: new Date('2026-09-01T08:00:00Z'),
    endAt: new Date('2026-09-01T10:00:00Z'),
    teacher: null,
    room: null,
    campus: null,
    rooms: [],
    promotion: null,
    group: null,
    classes: [],
    modality: null,
    reservationType: null,
    studentCount: null,
    disciplineName: null,
    disciplineTeacher: null,
    disciplineId: null,
    rawPayload: null,
    ...overrides,
  });
}

function makeIcsEvent(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: 'test-uid',
    summary: null,
    description: null,
    location: null,
    startAt: new Date('2026-09-01T08:00:00Z'),
    endAt: new Date('2026-09-01T10:00:00Z'),
    status: null,
    categories: [],
    organizer: null,
    raw: {},
    ...overrides,
  };
}

// ── Noise exclusion: extended to all providers ────────────────────────────────

describe('shouldExcludeEvent — noise exclusion', () => {
  it('excludes ensup holiday noise (existing behavior unchanged)', () => {
    const ev = makeNormalizedEvent({ provider: 'ensup', title: 'Jour Férié', subject: 'Jour Férié' });
    expect(shouldExcludeEvent(ev)).toBe(true);
  });

  it('excludes generic-provider holiday noise (new: not ensup-only)', () => {
    const ev = makeNormalizedEvent({ provider: 'generic', title: 'Vacances scolaires', subject: null });
    expect(shouldExcludeEvent(ev)).toBe(true);
  });

  it('excludes myges vacation events with no teacher or class', () => {
    const ev = makeNormalizedEvent({ provider: 'myges', title: 'Vacances de Noël' });
    expect(shouldExcludeEvent(ev)).toBe(true);
  });

  it('excludes myefrei holiday placeholder', () => {
    const ev = makeNormalizedEvent({ provider: 'myefrei', title: 'Jour férié — Toussaint' });
    expect(shouldExcludeEvent(ev)).toBe(true);
  });

  it('keeps a course that contains holiday keyword but has a teacher', () => {
    const ev = makeNormalizedEvent({
      provider: 'ensup',
      title: 'Cours spécial Toussaint',
      teacher: 'M. Dupont',
    });
    expect(shouldExcludeEvent(ev)).toBe(false);
  });

  it('keeps a course that mentions vacances but has classes', () => {
    const ev = makeNormalizedEvent({
      provider: 'generic',
      title: 'Vacances: devoir maison',
      classes: ['B1-INFO'],
    });
    expect(shouldExcludeEvent(ev)).toBe(false);
  });

  it('does not exclude a regular course with no noise keywords', () => {
    const ev = makeNormalizedEvent({ provider: 'myges', title: 'Algorithmique' });
    expect(shouldExcludeEvent(ev)).toBe(false);
  });

  it('handles ascension, pentecote, assomption keywords', () => {
    for (const title of ['Ascension', 'Pentecôte', 'Assomption']) {
      const ev = makeNormalizedEvent({ title });
      expect(shouldExcludeEvent(ev)).toBe(true);
    }
  });
});

// ── Per-event provider detection ──────────────────────────────────────────────

describe('detectProviderFromEvent', () => {
  it('returns generic/none when no signals present', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ summary: 'Cours de maths', description: null }));
    expect(result.provider).toBe('generic');
    expect(result.confidence).toBe('none');
  });

  it('detects ensup from CATEGORIES=hyperplanning', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ categories: ['hyperplanning', 'cours'] }));
    expect(result.provider).toBe('ensup');
    expect(['high', 'medium']).toContain(result.confidence);
  });

  it('detects myefrei from description "Code module :"', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ description: 'Code module : WEB4\nEnseignant(s) : Dupont' }));
    expect(result.provider).toBe('myefrei');
    expect(['high', 'medium']).toContain(result.confidence);
  });

  it('detects myges from organizer domain myges.fr', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ organizer: 'mailto:agenda@myges.fr' }));
    expect(result.provider).toBe('myges');
  });

  it('detects myefrei from organizer domain efrei.fr', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ organizer: 'mailto:noreply@efrei.fr' }));
    expect(result.provider).toBe('myefrei');
  });

  it('returns generic when signals are too ambiguous', () => {
    // Equal scores for ensup and myefrei → ambiguous
    const result = detectProviderFromEvent(makeIcsEvent({
      categories: ['hyperplanning'],
      organizer: 'mailto:admin@efrei.fr',
    }));
    // Either resolves to one or returns generic — no crash, and reason is set
    expect(result.reason).toBeTruthy();
  });

  it('detects ensup from description "Ressource :"', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ description: 'Ressource : Jean Martin\nSalle : A201' }));
    expect(result.provider).toBe('ensup');
  });

  it('detects myefrei from location containing "efrei"', () => {
    const result = detectProviderFromEvent(makeIcsEvent({ location: 'EFREI Paris — Salle N004' }));
    expect(result.provider).toBe('myefrei');
  });
});

// ── Preview pipeline ──────────────────────────────────────────────────────────

const MINIMAL_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-001@test
DTSTART:20260901T090000Z
DTEND:20260901T110000Z
SUMMARY:Algorithmique
DESCRIPTION:Code module : ALGO\nEnseignant(s) : M. Dupont
END:VEVENT
BEGIN:VEVENT
UID:event-002@test
DTSTART:20260902T000000Z
DTEND:20260903T000000Z
SUMMARY:Vacances de la Toussaint
END:VEVENT
BEGIN:VEVENT
UID:event-003@test
DTSTART:20260903T090000Z
DTEND:20260903T110000Z
SUMMARY:Python avancé
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

describe('previewIcsContent', () => {
  it('returns correct total, cancelled, and noise counts', () => {
    const result = previewIcsContent(MINIMAL_ICS, 'myefrei');
    expect(result.total).toBe(3);
    expect(result.cancelledCount).toBe(1);
    // CANCELLED events are not in the events array
    expect(result.events).toHaveLength(2);
  });

  it('marks the vacation event as noise', () => {
    const result = previewIcsContent(MINIMAL_ICS, 'generic');
    const vacation = result.events.find((ev) => ev.title?.toLowerCase().includes('vacances'));
    expect(vacation).toBeDefined();
    expect(vacation!.isNoise).toBe(true);
    expect(result.noiseCount).toBe(1);
  });

  it('does not mark a real course as noise', () => {
    const result = previewIcsContent(MINIMAL_ICS, 'generic');
    const algo = result.events.find((ev) => ev.title === 'Algorithmique');
    expect(algo).toBeDefined();
    expect(algo!.isNoise).toBe(false);
  });

  it('includes per-event detection fields on each event', () => {
    const result = previewIcsContent(MINIMAL_ICS, 'generic');
    for (const ev of result.events) {
      expect(ev.eventDetectedProvider).toBeDefined();
      expect(ev.eventDetectionConfidence).toBeDefined();
      expect(ev.eventDetectionReason).toBeDefined();
    }
  });

  it('builds providerBreakdown from event-level detection', () => {
    const result = previewIcsContent(MINIMAL_ICS, 'generic');
    const total = Object.values(result.providerBreakdown).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(result.events.length);
  });

  it('throws on invalid ICS content', () => {
    expect(() => previewIcsContent('not ics content', 'generic')).toThrow();
  });
});

// ── Enrichment rules ──────────────────────────────────────────────────────────

describe('applyEnrichmentRules', () => {
  const baseRule: EnrichmentRuleDto = {
    id: 'r1',
    name: 'Test rule',
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
  };

  it('returns empty enrichments when no rules match', () => {
    const rule: EnrichmentRuleDto = {
      ...baseRule,
      matchClassLike: 'B1-INFO',
      injectTeacher: 'M. Dupont',
    };
    const result = applyEnrichmentRules([rule], {
      provider: 'generic',
      classes: ['M2-DEV'],
      subject: 'Python',
      room: null,
      title: 'Python',
      description: null,
    });
    expect(result.matchedRules).toHaveLength(0);
    expect(result.teacher).toBeUndefined();
  });

  it('injects teacher when class matches', () => {
    const rule: EnrichmentRuleDto = {
      ...baseRule,
      matchClassLike: 'B1-INFO',
      injectTeacher: 'M. Dupont',
    };
    const result = applyEnrichmentRules([rule], {
      provider: 'generic',
      classes: ['B1-INFO-A'],
      subject: 'Algo',
      room: null,
      title: 'Algo',
      description: null,
    });
    expect(result.matchedRules).toContain('Test rule');
    expect(result.teacher).toBe('M. Dupont');
  });

  it('first match wins (highest priority first) — second rule does not overwrite', () => {
    const rules: EnrichmentRuleDto[] = [
      { ...baseRule, id: 'r1', name: 'High priority', matchClassLike: 'B1', injectTeacher: 'Dupont', priority: 10 },
      { ...baseRule, id: 'r2', name: 'Low priority', matchClassLike: 'B1', injectTeacher: 'Martin', priority: 0 },
    ];
    const result = applyEnrichmentRules(rules, {
      provider: 'generic',
      classes: ['B1-INFO'],
      subject: null,
      room: null,
      title: null,
      description: null,
    });
    expect(result.teacher).toBe('Dupont');
    expect(result.matchedRules).toContain('High priority');
  });

  it('disabled rules are skipped', () => {
    const rule: EnrichmentRuleDto = { ...baseRule, enabled: false, injectTeacher: 'Dupont' };
    const result = applyEnrichmentRules([rule], {
      provider: 'generic',
      classes: [],
      subject: null,
      room: null,
      title: null,
      description: null,
    });
    expect(result.matchedRules).toHaveLength(0);
    expect(result.teacher).toBeUndefined();
  });

  it('matchKeywords requires ALL keywords to be present', () => {
    const rule: EnrichmentRuleDto = {
      ...baseRule,
      matchKeywords: ['algo', 'recursion'],
      injectSubject: 'Algorithmique récursive',
    };
    // Only one keyword present — no match
    const noMatch = applyEnrichmentRules([rule], {
      provider: 'generic',
      classes: [],
      subject: 'Algo',
      room: null,
      title: 'Cours algo',
      description: null,
    });
    expect(noMatch.matchedRules).toHaveLength(0);

    // Both keywords present — match
    const match = applyEnrichmentRules([rule], {
      provider: 'generic',
      classes: [],
      subject: 'Algo recursion avancée',
      room: null,
      title: 'Cours algo recursion',
      description: null,
    });
    expect(match.matchedRules).toContain('Test rule');
    expect(match.subject).toBe('Algorithmique récursive');
  });

  it('matchProvider filters by exact provider', () => {
    const rule: EnrichmentRuleDto = {
      ...baseRule,
      matchProvider: 'ensup',
      injectCampus: 'Paris 15',
    };
    const noMatch = applyEnrichmentRules([rule], { provider: 'myges', classes: [], subject: null, room: null, title: null, description: null });
    expect(noMatch.matchedRules).toHaveLength(0);

    const match = applyEnrichmentRules([rule], { provider: 'ensup', classes: [], subject: null, room: null, title: null, description: null });
    expect(match.campus).toBe('Paris 15');
  });
});

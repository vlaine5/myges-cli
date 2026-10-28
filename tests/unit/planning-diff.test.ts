import { describe, expect, it } from 'vitest';
import { diffPlanning, type PlanningEvent } from '../../src/modules/notifications/planning-diff';
import { buildPlanningMessage, buildWebhookPayload } from '../../src/modules/notifications/notification-message';

const now = new Date('2026-10-28T08:00:00.000Z');
const window = { now, horizonEnd: new Date('2026-11-11T08:00:00.000Z') };

function course(id: string, startIso: string, overrides: Partial<PlanningEvent> = {}): PlanningEvent {
  const startAt = new Date(startIso);
  return {
    id,
    title: 'Algorithmique',
    startAt,
    endAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    room: 'Salle 101',
    campus: 'Paris',
    teacher: null,
    modality: null,
    ...overrides,
  };
}

describe('diffPlanning', () => {
  it('reports nothing when the planning is the same', () => {
    const planning = [course('a', '2026-10-29T08:00:00Z'), course('b', '2026-10-30T08:00:00Z')];
    const diff = diffPlanning(planning, planning.map((event) => ({ ...event })), window);
    expect(diff).toEqual({ added: [], updated: [], removed: [] });
  });

  it('ignores whitespace and empty-vs-null differences', () => {
    const before = [course('a', '2026-10-29T08:00:00Z', { teacher: null })];
    const after = [course('a', '2026-10-29T08:00:00Z', { teacher: '  ', room: 'Salle 101 ' })];
    expect(diffPlanning(before, after, window).updated).toHaveLength(0);
  });

  it('reports added, modified and cancelled courses', () => {
    const before = [course('a', '2026-10-29T08:00:00Z'), course('b', '2026-10-30T08:00:00Z')];
    const after = [
      course('a', '2026-10-29T09:00:00Z'),
      course('c', '2026-10-31T08:00:00Z', { title: 'Réseaux' }),
    ];
    const diff = diffPlanning(before, after, window);
    expect(diff.added.map((event) => event.id)).toEqual(['c']);
    expect(diff.removed.map((event) => event.id)).toEqual(['b']);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]?.changedFields).toEqual(['startAt', 'endAt']);
  });

  it('does not report a course that only changed id', () => {
    const before = [course('ics:1', '2026-10-29T08:00:00Z')];
    const after = [course('api:1', '2026-10-29T08:00:00Z')];
    expect(diffPlanning(before, after, window)).toEqual({ added: [], updated: [], removed: [] });
  });

  it('reports a new id with the same title and times as an update', () => {
    const before = [course('ics:1', '2026-10-29T08:00:00Z')];
    const after = [course('api:1', '2026-10-29T08:00:00Z', { room: 'Salle 204' })];
    const diff = diffPlanning(before, after, window);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.updated[0]?.changedFields).toEqual(['room']);
  });

  it('ignores fields only one source provides when a course changes id', () => {
    // API fills campus, ICS does not: switching sources is not a planning change
    const before = [course('api:1', '2026-10-29T08:00:00Z', { campus: 'Paris', room: 'Salle 101' })];
    const after = [course('ics:1', '2026-10-29T08:00:00Z', { campus: null, room: 'Salle 101' })];
    expect(diffPlanning(before, after, window)).toEqual({ added: [], updated: [], removed: [] });

    const moved = [course('ics:1', '2026-10-29T08:00:00Z', { campus: null, room: 'Salle 204' })];
    expect(diffPlanning(before, moved, window).updated[0]?.changedFields).toEqual(['room']);
  });

  it('only keeps changes touching the horizon', () => {
    const before = [course('moved', '2026-10-30T08:00:00Z')];
    const after = [
      course('moved', '2026-11-20T08:00:00Z'),
      // Entered the fetch window weeks ahead: not news
      course('far', '2026-11-25T08:00:00Z'),
    ];
    const diff = diffPlanning(before, after, window);
    expect(diff.added).toHaveLength(0);
    // Moved out of the horizon: still reported, it left the next two weeks
    expect(diff.updated.map((update) => update.after.id)).toEqual(['moved']);
  });
});

describe('planning messages', () => {
  const diff = diffPlanning(
    [course('a', '2026-10-29T08:00:00Z'), course('b', '2026-10-30T08:00:00Z')],
    [course('a', '2026-10-29T08:00:00Z', { room: 'Salle 204' }), course('c', '2026-10-31T13:00:00Z', { title: '<Réseaux>' })],
    window,
  );

  it('lists each change in the app timezone', () => {
    const message = buildPlanningMessage('MyGES', diff, 'Europe/Paris');
    expect(message.subject).toBe('[MyGES] Planning modifié : 1 nouveau cours, 1 cours modifié, 1 cours annulé');
    expect(message.text).toContain('sam. 31 oct. 14:00–16:00 · <Réseaux> · Salle 101, Paris');
    expect(message.text).toContain('salle : Salle 101 → Salle 204');
    expect(message.html).toContain('&lt;Réseaux&gt;');
    expect(message.html).not.toContain('<Réseaux>');
  });

  it('shapes webhook payloads per format', () => {
    const message = buildPlanningMessage('MyGES', diff, 'Europe/Paris');
    const context = { provider: 'myges', providerLabel: 'MyGES' };
    expect(buildWebhookPayload('discord', context, diff, message)).toEqual({
      content: expect.stringContaining('[MyGES]'),
      allowed_mentions: { parse: [] },
    });
    const slack = buildWebhookPayload('slack', context, diff, message) as { text: string };
    expect(slack.text).toContain('&lt;Réseaux&gt;');
    expect(slack.text).not.toContain('<Réseaux>');
    const json = buildWebhookPayload('json', context, diff, message) as { changeCount: number; changes: { added: unknown[] } };
    expect(json.changeCount).toBe(3);
    expect(json.changes.added).toHaveLength(1);
  });
});

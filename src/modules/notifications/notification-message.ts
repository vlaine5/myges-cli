import type { PlanningDiff, PlanningEvent, PlanningField, PlanningUpdate } from './planning-diff';
import { countChanges } from './planning-diff';

export type WebhookFormat = 'json' | 'discord' | 'slack';

/** Longest list shown per section; the rest is summarised as a count. */
const MAX_ITEMS_PER_SECTION = 40;
const DISCORD_CONTENT_LIMIT = 2000;

const FIELD_LABELS: Record<PlanningField, string> = {
  title: 'intitulé',
  startAt: 'début',
  endAt: 'fin',
  room: 'salle',
  campus: 'campus',
  teacher: 'intervenant',
  modality: 'modalité',
};

export interface PlanningMessage {
  subject: string;
  text: string;
  html: string;
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function summarizeDiff(diff: PlanningDiff) {
  const parts = [
    diff.added.length ? plural(diff.added.length, 'nouveau cours', 'nouveaux cours') : null,
    diff.updated.length ? plural(diff.updated.length, 'cours modifié', 'cours modifiés') : null,
    diff.removed.length ? plural(diff.removed.length, 'cours annulé', 'cours annulés') : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function makeFormatters(timeZone: string) {
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone });
  const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });

  const slot = (event: PlanningEvent) => {
    const sameDay = dayKey.format(event.startAt) === dayKey.format(event.endAt);
    return sameDay
      ? `${day.format(event.startAt)} ${time.format(event.startAt)}–${time.format(event.endAt)}`
      : `${day.format(event.startAt)} ${time.format(event.startAt)} → ${day.format(event.endAt)} ${time.format(event.endAt)}`;
  };

  return { slot };
}

function place(event: PlanningEvent) {
  return [event.room, event.campus].filter(Boolean).join(', ') || null;
}

function describeEvent(event: PlanningEvent, slot: (event: PlanningEvent) => string) {
  return [slot(event), event.title, place(event), event.teacher].filter(Boolean).join(' · ');
}

function describeUpdate(update: PlanningUpdate, slot: (event: PlanningEvent) => string) {
  const { before, after, changedFields } = update;
  const details: string[] = [];

  if (changedFields.includes('startAt') || changedFields.includes('endAt')) {
    details.push(`horaire : ${slot(before)} → ${slot(after)}`);
  }
  for (const field of changedFields) {
    if (field === 'startAt' || field === 'endAt') continue;
    details.push(`${FIELD_LABELS[field]} : ${before[field] || '—'} → ${after[field] || '—'}`);
  }

  return { heading: `${after.title} (${slot(after)})`, details };
}

interface Section {
  title: string;
  lines: Array<{ heading: string; details: string[] }>;
  hidden: number;
}

function buildSections(diff: PlanningDiff, timeZone: string): Section[] {
  const { slot } = makeFormatters(timeZone);
  const section = <T>(title: string, items: T[], describe: (item: T) => { heading: string; details: string[] }) => ({
    title,
    lines: items.slice(0, MAX_ITEMS_PER_SECTION).map(describe),
    hidden: Math.max(0, items.length - MAX_ITEMS_PER_SECTION),
  });

  return [
    section('Nouveaux cours', diff.added, (event) => ({ heading: describeEvent(event, slot), details: [] })),
    section('Cours modifiés', diff.updated, (update) => describeUpdate(update, slot)),
    section('Cours annulés', diff.removed, (event) => ({ heading: describeEvent(event, slot), details: [] })),
  ].filter((entry) => entry.lines.length > 0);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderText(intro: string, sections: Section[]) {
  const blocks = sections.map((section) =>
    [
      section.title,
      ...section.lines.flatMap((line) => [`- ${line.heading}`, ...line.details.map((detail) => `    ${detail}`)]),
      ...(section.hidden ? [`- … et ${section.hidden} autre(s)`] : []),
    ].join('\n'),
  );
  return [intro, ...blocks].join('\n\n');
}

function renderHtml(intro: string, sections: Section[]) {
  const body = sections
    .map((section) => {
      const items = section.lines
        .map((line) => {
          const details = line.details.length
            ? `<br><span style="color:#555">${line.details.map(escapeHtml).join('<br>')}</span>`
            : '';
          return `<li style="margin-bottom:6px">${escapeHtml(line.heading)}${details}</li>`;
        })
        .join('');
      const more = section.hidden ? `<li>… et ${section.hidden} autre(s)</li>` : '';
      return `<h3 style="margin:18px 0 6px;font-size:15px">${escapeHtml(section.title)}</h3><ul style="padding-left:18px;margin:0">${items}${more}</ul>`;
    })
    .join('');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.45;color:#1a1a1a"><p>${escapeHtml(intro)}</p>${body}</div>`;
}

export function buildPlanningMessage(providerLabel: string, diff: PlanningDiff, timeZone: string): PlanningMessage {
  const summary = summarizeDiff(diff);
  const intro = `Changements détectés dans le planning ${providerLabel} : ${summary}.`;
  const sections = buildSections(diff, timeZone);

  return {
    subject: `[${providerLabel}] Planning modifié : ${summary}`,
    text: renderText(intro, sections),
    html: renderHtml(intro, sections),
  };
}

function eventPayload(event: PlanningEvent) {
  return {
    id: event.id,
    title: event.title,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    room: event.room,
    campus: event.campus,
    teacher: event.teacher,
    modality: event.modality,
  };
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function buildWebhookPayload(
  format: WebhookFormat,
  context: { provider: string | null; providerLabel: string; test?: boolean },
  diff: PlanningDiff,
  message: PlanningMessage,
) {
  const text = `${message.subject}\n\n${message.text}`;

  // Titles and rooms come from the provider: they must not ping anyone or
  // turn into links or markup.
  if (format === 'discord') {
    return { content: truncate(text, DISCORD_CONTENT_LIMIT), allowed_mentions: { parse: [] } };
  }
  if (format === 'slack') {
    return { text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  }

  return {
    type: 'planning.changed',
    test: context.test ?? false,
    provider: context.provider,
    providerLabel: context.providerLabel,
    summary: summarizeDiff(diff),
    changeCount: countChanges(diff),
    subject: message.subject,
    text: message.text,
    changes: {
      added: diff.added.map(eventPayload),
      updated: diff.updated.map((update) => ({
        changedFields: update.changedFields,
        before: eventPayload(update.before),
        after: eventPayload(update.after),
      })),
      removed: diff.removed.map(eventPayload),
    },
  };
}

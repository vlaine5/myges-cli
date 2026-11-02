import PDFDocument from 'pdfkit';
import type { EventDto } from '../events/types';

export type PdfGroupBy = 'none' | 'provider' | 'subject';

export interface PdfExportOptions {
  events: EventDto[];
  groupBy: PdfGroupBy;
  timeZone: string;
  range: { start: Date; end: Date };
  title?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  myges: 'MyGES',
  myefrei: 'myEfrei',
  ensup: 'Ensup (HyperPlanning)',
  generic: 'Agenda',
};

const ACCENT = '#4f46e5';
const MUTED = '#6b7280';
const INK = '#111827';
const MARGIN = 36;

export function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone, ...options });
}

function groupEvents(events: EventDto[], groupBy: PdfGroupBy) {
  const groups = new Map<string, EventDto[]>();
  for (const event of events) {
    const key =
      groupBy === 'provider'
        ? providerLabel(event.provider)
        : groupBy === 'subject'
          ? event.subject || event.title || 'Sans matière'
          : 'Agenda';
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'fr'));
}

export function renderEventsPdf(options: PdfExportOptions): PDFKit.PDFDocument {
  const { events, groupBy, timeZone, range } = options;
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: options.title ?? 'Planning' } });
  const dayFormat = formatter(timeZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeFormat = formatter(timeZone, { hour: '2-digit', minute: '2-digit' });
  const dayKey = formatter(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const rangeFormat = formatter(timeZone, { day: 'numeric', month: 'long', year: 'numeric' });
  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 18;

  const groups = groupEvents(events, groupBy);
  if (groups.length === 0) groups.push(['Agenda', []]);

  groups.forEach(([name, list], index) => {
    if (index > 0) doc.addPage();

    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(20).text(groupBy === 'none' ? (options.title ?? 'Planning') : name, MARGIN, MARGIN);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(
        `${rangeFormat.format(range.start)} – ${rangeFormat.format(range.end)} · ${list.length} cours`,
        MARGIN,
        doc.y + 2,
      );
    doc.moveTo(MARGIN, doc.y + 8).lineTo(MARGIN + width, doc.y + 8).strokeColor(ACCENT).lineWidth(1.5).stroke();
    doc.y += 18;

    if (list.length === 0) {
      doc.fillColor(MUTED).fontSize(11).text('Aucun cours sur la période.', MARGIN, doc.y);
      return;
    }

    let currentDay = '';
    for (const event of list) {
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);
      const day = dayKey.format(start);
      const details = [
        groupBy === 'provider' || groupBy === 'none' ? event.subject : null,
        event.room ?? event.rooms?.[0]?.name,
        event.teacher,
        groupBy === 'subject' || groupBy === 'none' ? providerLabel(event.provider) : null,
      ]
        .filter(Boolean)
        .join('  ·  ');

      const needed = (day !== currentDay ? 34 : 0) + 32;
      if (doc.y + needed > bottom()) doc.addPage();

      if (day !== currentDay) {
        currentDay = day;
        const label = dayFormat.format(start);
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(label.charAt(0).toUpperCase() + label.slice(1), MARGIN, doc.y + 6);
        doc.y += 3;
      }

      const top = doc.y;
      doc.rect(MARGIN, top, 3, 26).fill(ACCENT);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(`${timeFormat.format(start)} – ${timeFormat.format(end)}`, MARGIN + 10, top + 2, { width: 88, lineBreak: false });
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(event.title, MARGIN + 104, top + 1, { width: width - 104, height: 12, ellipsis: true });
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8.5)
        .text(details, MARGIN + 104, top + 14, { width: width - 104, height: 11, ellipsis: true });
      doc.y = top + 32;
    }
  });

  const generated = new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(`Généré le ${generated} · page ${i - pages.start + 1}/${pages.count}`, MARGIN, doc.page.height - MARGIN + 2, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }

  return doc;
}

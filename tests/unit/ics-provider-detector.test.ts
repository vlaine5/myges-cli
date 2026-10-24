import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { detectProviderFromIcs } from '../../src/lib/ics-provider-detector';

const FIXTURES = join(__dirname, '../fixtures');

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURES, filename), 'utf-8');
}

describe('detectProviderFromIcs', () => {
  it('detects ensup/HyperPlanning from PRODID and CATEGORIES', () => {
    const content = loadFixture('sample-hyperplanning.ics');
    const result = detectProviderFromIcs(content);
    expect(result.provider).toBe('ensup');
    expect(['high', 'medium']).toContain(result.confidence);
    expect(result.reason).toBeTruthy();
  });

  it('returns generic with none confidence for unrecognized ICS', () => {
    const content = loadFixture('sample-generic.ics');
    const result = detectProviderFromIcs(content);
    expect(result.provider).toBe('generic');
    expect(result.confidence).toBe('none');
  });

  it('detects myefrei from PRODID', () => {
    const content = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Efrei Paris//MyEfrei Calendar//FR',
      'X-WR-CALNAME:Emploi du temps Efrei',
      'BEGIN:VEVENT',
      'UID:test@efrei.fr',
      'DTSTART:20260410T090000Z',
      'DTEND:20260410T110000Z',
      'SUMMARY:Cours',
      'ORGANIZER:mailto:admin@efrei.fr',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = detectProviderFromIcs(content);
    expect(result.provider).toBe('myefrei');
    expect(result.confidence).not.toBe('none');
  });

  it('detects myges from PRODID and X-WR-CALNAME', () => {
    const content = [
      'BEGIN:VCALENDAR',
      'PRODID:-//MyGES//Agenda Etudiant//FR',
      'X-WR-CALNAME:Mon agenda GES',
      'BEGIN:VEVENT',
      'UID:ges-test@myges.fr',
      'DTSTART:20260410T090000Z',
      'DTEND:20260410T110000Z',
      'SUMMARY:TD Informatique',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = detectProviderFromIcs(content);
    expect(result.provider).toBe('myges');
    expect(result.confidence).not.toBe('none');
  });

  it('detects ensup from HyperPlanning PRODID alone', () => {
    const content = [
      'BEGIN:VCALENDAR',
      'PRODID:-//HyperPlanning 2024//FR',
      'BEGIN:VEVENT',
      'UID:hp-test@school.fr',
      'DTSTART:20260410T090000Z',
      'DTEND:20260410T110000Z',
      'SUMMARY:Cours magistral',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = detectProviderFromIcs(content);
    expect(result.provider).toBe('ensup');
    expect(result.confidence).toBe('high');
  });

  it('does not confuse myefrei organizer with myges CALNAME', () => {
    const content = [
      'BEGIN:VCALENDAR',
      'PRODID:-//HyperPlanning//FR',
      'X-WR-CALNAME:Efrei Paris Planning',
      'BEGIN:VEVENT',
      'UID:mixed@test.com',
      'DTSTART:20260410T090000Z',
      'DTEND:20260410T110000Z',
      'SUMMARY:Cours',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = detectProviderFromIcs(content);
    // HyperPlanning in PRODID = 10 pts for ensup; "Efrei" in calname = 8 pts for myefrei
    // ensup should win
    expect(result.provider).toBe('ensup');
  });

  it('returns reason string explaining the detection', () => {
    const content = loadFixture('sample-hyperplanning.ics');
    const result = detectProviderFromIcs(content);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

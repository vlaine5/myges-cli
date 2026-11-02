import { describe, expect, it } from 'vitest';
import { isWebcalUrl, normalizeIcsUrl } from '../../src/lib/ics-parser';

describe('normalizeIcsUrl', () => {
  it('reads webcal:// as https://', () => {
    expect(normalizeIcsUrl('webcal://www.myefrei.fr/api/public/teacher/planning/abc')).toBe(
      'https://www.myefrei.fr/api/public/teacher/planning/abc',
    );
    expect(normalizeIcsUrl(' WEBCAL://host/x.ics ')).toBe('https://host/x.ics');
    expect(normalizeIcsUrl('webcals://host/x.ics')).toBe('https://host/x.ics');
  });

  it('keeps http(s) links and adds https to bare hosts', () => {
    expect(normalizeIcsUrl('http://host/x.ics')).toBe('http://host/x.ics');
    expect(normalizeIcsUrl('https://host/x.ics')).toBe('https://host/x.ics');
    expect(normalizeIcsUrl('host/x.ics')).toBe('https://host/x.ics');
  });

  it('detects webcal links', () => {
    expect(isWebcalUrl('webcal://host/x')).toBe(true);
    expect(isWebcalUrl('https://host/x')).toBe(false);
  });
});

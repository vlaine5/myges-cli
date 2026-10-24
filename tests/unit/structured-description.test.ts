import { describe, expect, it } from 'vitest';
import { parseStructuredDescription } from '../../src/modules/events/structured-description';

describe('parseStructuredDescription', () => {
  it('extracts myEfrei-style fields including groups and student count', () => {
    const parsed = parseStructuredDescription([
      'Code module: XCS-07-2526PAN01',
      'Enseignant(s): LAINÉ Vincent',
      'Groupe(s): B3-CS-FISA2 / B3-CS-FISA3',
      'Modalité : Présentiel',
      'Activité: CTD',
      "Nombre d'élèves: 28",
    ].join('\n'));

    expect(parsed.moduleCode).toBe('XCS-07-2526PAN01');
    expect(parsed.teacher).toBe('LAINÉ Vincent');
    expect(parsed.groups).toEqual(['B3-CS-FISA2', 'B3-CS-FISA3']);
    expect(parsed.modality).toBe('Présentiel');
    expect(parsed.activityType).toBe('CTD');
    expect(parsed.studentCount).toBe(28);
  });

  it('extracts ensup-style fields', () => {
    const parsed = parseStructuredDescription([
      'Matière : Analyse SI',
      'Enseignant : LAINÉ',
      'Promotion : M2 SSR',
      'Salle : RDC - LISBONNE',
    ].join('\n'));

    expect(parsed.subject).toBe('Analyse SI');
    expect(parsed.teacher).toBe('LAINÉ');
    expect(parsed.groups).toEqual(['M2 SSR']);
    expect(parsed.room).toBe('RDC - LISBONNE');
  });
});

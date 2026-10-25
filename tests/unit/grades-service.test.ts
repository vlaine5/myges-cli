import { describe, expect, it } from 'vitest';
import { GradesService } from '../../src/modules/grades/grades.service';
import type { ProviderGradePayload } from '../../src/modules/providers/types';

// Aggregation is pure; we don't need a real provider to test buildBulletin.
const service = new GradesService({} as never);

const sample: ProviderGradePayload[] = [
  {
    year: 2025,
    trimester: 1,
    trimester_name: 'Trimestre 1',
    course: 'Algorithmique',
    teacher_civility: 'M.',
    teacher_first_name: 'Jean',
    teacher_last_name: 'Dupont',
    coef: 2,
    ects: 4,
    grades: [12, 16], // mean = 14 (no upstream average)
    average: null,
    exam: 15,
  },
  {
    year: 2025,
    trimester: 1,
    trimester_name: 'Trimestre 1',
    course: 'Mathématiques',
    teacher_civility: 'Mme',
    teacher_first_name: 'Marie',
    teacher_last_name: 'Martin',
    coef: '3', // numeric string
    ects: '5',
    grades: [],
    average: 10, // upstream average wins
    exam: null,
  },
  {
    year: 2025,
    trimester: 2,
    trimester_name: 'Trimestre 2',
    course: 'Projet',
    teacher_civility: null,
    teacher_first_name: null,
    teacher_last_name: null,
    coef: null, // no coef and no ects -> weight falls back to 1
    ects: null,
    grades: [8],
    average: null,
    exam: null,
  },
];

describe('GradesService.buildBulletin', () => {
  const bulletin = service.buildBulletin('myges', '2025', ['2025', '2024'], sample);

  it('groups courses by trimester, sorted ascending', () => {
    expect(bulletin.trimesters.map((t) => t.trimester)).toEqual(['1', '2']);
    expect(bulletin.trimesters[0]!.courses).toHaveLength(2);
    expect(bulletin.trimesters[1]!.courses).toHaveLength(1);
  });

  it('derives the effective average from continuous marks when upstream average is null', () => {
    const algo = bulletin.trimesters[0]!.courses.find((c) => c.course === 'Algorithmique')!;
    expect(algo.average).toBe(14); // mean(12,16)
  });

  it('keeps the upstream average when present', () => {
    const maths = bulletin.trimesters[0]!.courses.find((c) => c.course === 'Mathématiques')!;
    expect(maths.average).toBe(10);
  });

  it('computes the weighted trimester average (coef, string coefs parsed)', () => {
    // (14*2 + 10*3) / (2+3) = 58/5 = 11.6
    expect(bulletin.trimesters[0]!.average).toBeCloseTo(11.6, 5);
  });

  it('falls back to weight 1 when neither coef nor ects is set', () => {
    expect(bulletin.trimesters[1]!.average).toBe(8);
  });

  it('exposes CC column width and ECTS totals per trimester', () => {
    expect(bulletin.trimesters[0]!.maxContinuous).toBe(2);
    expect(bulletin.trimesters[0]!.ectsTotal).toBe(9); // 4 + 5
  });

  it('computes an overall weighted average and total ECTS', () => {
    // (14*2 + 10*3 + 8*1) / (2+3+1) = 66/6 = 11
    expect(bulletin.overallAverage).toBe(11);
    expect(bulletin.ectsTotal).toBe(9);
    expect(bulletin.courseCount).toBe(3);
    expect(bulletin.availableYears).toEqual(['2025', '2024']);
  });

  it('builds a readable teacher label and tolerates missing names', () => {
    const algo = bulletin.trimesters[0]!.courses.find((c) => c.course === 'Algorithmique')!;
    expect(algo.teacher).toBe('M. Jean Dupont');
    expect(bulletin.trimesters[1]!.courses[0]!.teacher).toBeNull();
  });
});

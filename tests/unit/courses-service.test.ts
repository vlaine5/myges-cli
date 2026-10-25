import { describe, expect, it } from 'vitest';
import { CoursesService } from '../../src/modules/courses/courses.service';
import type { ProviderCoursePayload } from '../../src/modules/providers/types';

const service = new CoursesService({} as never);

const sample: ProviderCoursePayload[] = [
  {
    year: 2026,
    name: 'LINUX ADMINISTRATION AVANCÉE LPIC-1',
    teacher: 'Jean Martin',
    trimester: 'Semestre 1',
    coef: 2,
    ects: '3',
    nb_students: 31,
    rc_id: 1001,
    student_group_name: '3 ESGI ALT - T1 - SRC 3 - PARIS',
    has_grades: true,
    has_documents: false,
  },
  {
    year: 2026,
    name: 'ARCHITECTURE DES RÉSEAUX',
    teacher: 'Jean Martin',
    trimester: 'Semestre 1',
    coef: null,
    ects: null,
    nb_students: 40,
    rc_id: 1002,
    student_group_name: '1 ESGI INI - S1 - Classe 1 - PARIS',
    has_grades: false,
    has_documents: true,
  },
  {
    year: 2026,
    name: 'DEVSECOPS',
    teacher: 'Jean Martin',
    trimester: 'Semestre 2',
    coef: 4,
    ects: 5,
    nb_students: 26,
    rc_id: 2001,
    student_group_name: '5 ESGI ALT - T1 - SRC 1 - PARIS',
    has_grades: true,
    has_documents: true,
  },
];

describe('CoursesService.buildView', () => {
  const view = service.buildView('myges', '2026', ['2026', '2025', '2024'], sample);

  it('groups courses by trimester, sorted', () => {
    expect(view.groups.map((g) => g.trimester)).toEqual(['Semestre 1', 'Semestre 2']);
    expect(view.groups[0]!.courses).toHaveLength(2);
    expect(view.groups[1]!.courses).toHaveLength(1);
  });

  it('sums students per trimester and overall', () => {
    expect(view.groups[0]!.students).toBe(71); // 31 + 40
    expect(view.totalStudents).toBe(97); // 71 + 26
  });

  it('counts distinct classes and total courses', () => {
    expect(view.courseCount).toBe(3);
    expect(view.classCount).toBe(3);
  });

  it('normalizes numbers, strings and nulls, and content flags', () => {
    const linux = view.groups[0]!.courses.find((c) => c.name.startsWith('LINUX'))!;
    expect(linux.ects).toBe(3); // from string "3"
    expect(linux.hasGrades).toBe(true);
    const archi = view.groups[0]!.courses.find((c) => c.name.startsWith('ARCHI'))!;
    expect(archi.coef).toBeNull();
    expect(archi.hasDocuments).toBe(true);
  });

  it('sorts available years descending', () => {
    expect(view.availableYears).toEqual(['2026', '2025', '2024']);
  });
});

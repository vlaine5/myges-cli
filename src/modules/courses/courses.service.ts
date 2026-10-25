import { AppError } from '../../lib/app-error';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { AcademicProvider, ProviderCoursePayload } from '../providers/types';

export interface CourseRow {
  name: string;
  teacher: string | null;
  studentGroup: string | null;
  students: number | null;
  coef: number | null;
  ects: number | null;
  trimester: string | null;
  rcId: number | null;
  hasGrades: boolean;
  hasDocuments: boolean;
}

export interface CourseGroup {
  trimester: string;
  courses: CourseRow[];
  students: number;
}

export interface CoursesView {
  provider: string;
  year: string;
  availableYears: string[];
  groups: CourseGroup[];
  courseCount: number;
  totalStudents: number;
  classCount: number;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));

  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: unknown): string | null {
  const text = (value ?? '').toString().trim();

  return text.length > 0 ? text : null;
}

export class CoursesService {
  constructor(private readonly providerRegistry: ProviderRegistryService) {}

  private static isCapable(provider: AcademicProvider): boolean {
    return typeof provider.fetchCourses === 'function' && typeof provider.listYears === 'function';
  }

  private async getCapableProvider(): Promise<AcademicProvider> {
    const active = await this.providerRegistry.getActiveProvider();

    if (CoursesService.isCapable(active)) {
      return active;
    }

    const fallback = this.providerRegistry
      .getProviders()
      .find((provider) => CoursesService.isCapable(provider));

    if (!fallback) {
      throw new AppError(
        `Provider "${active.id}" does not expose courses.`,
        400,
        'COURSES_NOT_SUPPORTED',
      );
    }

    return fallback;
  }

  async listYears(): Promise<string[]> {
    const provider = await this.getCapableProvider();

    return provider.listYears!();
  }

  async getCourses(requestedYear?: string): Promise<CoursesView> {
    const provider = await this.getCapableProvider();
    const availableYears = await provider.listYears!();
    const sortedYears = [...availableYears].sort((a, b) => Number(b) - Number(a));
    const year = requestedYear ?? sortedYears[0];

    if (!year) {
      throw new AppError('No academic year is available for this account.', 404, 'COURSES_NO_YEAR');
    }

    const raw = await provider.fetchCourses!(year);

    return this.buildView(provider.id, year, availableYears, raw);
  }

  /** Pure aggregation — exposed for testing. */
  buildView(
    providerId: string,
    year: string,
    availableYears: string[],
    raw: ProviderCoursePayload[],
  ): CoursesView {
    const byTrimester = new Map<string, CourseRow[]>();

    for (const course of raw ?? []) {
      const trimester = (course.trimester ?? '').toString().trim() || '—';
      const rows = byTrimester.get(trimester) ?? [];

      rows.push({
        name: cleanText(course.name) ?? '—',
        teacher: cleanText(course.teacher),
        studentGroup: cleanText(course.student_group_name),
        students: toNumber(course.nb_students),
        coef: toNumber(course.coef),
        ects: toNumber(course.ects),
        trimester: trimester === '—' ? null : trimester,
        rcId: toNumber(course.rc_id),
        hasGrades: Boolean(course.has_grades),
        hasDocuments: Boolean(course.has_documents),
      });

      byTrimester.set(trimester, rows);
    }

    const groups: CourseGroup[] = [...byTrimester.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))
      .map(([trimester, courses]) => ({
        trimester,
        courses,
        students: courses.reduce((sum, course) => sum + (course.students ?? 0), 0),
      }));

    const allCourses = groups.flatMap((group) => group.courses);
    const classes = new Set(
      allCourses.map((course) => course.studentGroup).filter((group): group is string => group !== null),
    );

    return {
      provider: providerId,
      year,
      availableYears: sortedByYearDesc(availableYears),
      groups,
      courseCount: allCourses.length,
      totalStudents: allCourses.reduce((sum, course) => sum + (course.students ?? 0), 0),
      classCount: classes.size,
    };
  }
}

function sortedByYearDesc(years: string[]): string[] {
  return [...years].sort((a, b) => Number(b) - Number(a));
}

import { AppError } from '../../lib/app-error';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { AcademicProvider, ProviderGradePayload } from '../providers/types';

export interface BulletinCourse {
  course: string;
  teacher: string | null;
  coef: number | null;
  ects: number | null;
  /** Continuous-assessment marks ("contrôle continu"), in upstream order. */
  continuous: Array<number | null>;
  exam: number | null;
  /** Effective average: the upstream average, or the mean of continuous marks when absent. */
  average: number | null;
}

export interface BulletinTrimester {
  trimester: string;
  trimesterName: string;
  courses: BulletinCourse[];
  /** Weighted average of graded courses (by coef, falling back to ects, then 1). */
  average: number | null;
  ectsTotal: number;
  /** Widest number of continuous marks across courses — drives the CC column count. */
  maxContinuous: number;
}

export interface Bulletin {
  provider: string;
  year: string;
  availableYears: string[];
  trimesters: BulletinTrimester[];
  overallAverage: number | null;
  ectsTotal: number;
  courseCount: number;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));

  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function effectiveAverage(grade: ProviderGradePayload): number | null {
  const upstream = toNumber(grade.average);

  if (upstream !== null) {
    return round2(upstream);
  }

  const marks = (grade.grades ?? []).map(toNumber).filter((mark): mark is number => mark !== null);

  if (marks.length === 0) {
    return null;
  }

  return round2(marks.reduce((sum, mark) => sum + mark, 0) / marks.length);
}

/** Weight used for the weighted average: coef, else ects, else 1 (mirrors the reference client). */
function courseWeight(course: BulletinCourse): number {
  return (course.coef && course.coef > 0 ? course.coef : null) ?? (course.ects && course.ects > 0 ? course.ects : null) ?? 1;
}

function weightedAverage(courses: BulletinCourse[]): number | null {
  let weightSum = 0;
  let weighted = 0;

  for (const course of courses) {
    if (course.average === null) {
      continue;
    }

    const weight = courseWeight(course);
    weightSum += weight;
    weighted += course.average * weight;
  }

  return weightSum > 0 ? round2(weighted / weightSum) : null;
}

function fullTeacher(grade: ProviderGradePayload): string | null {
  const name = [grade.teacher_civility, grade.teacher_first_name, grade.teacher_last_name]
    .map((part) => (part ?? '').toString().trim())
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();

  return name.length > 0 ? name : null;
}

export class GradesService {
  constructor(private readonly providerRegistry: ProviderRegistryService) {}

  private static isCapable(provider: AcademicProvider): boolean {
    return typeof provider.fetchGrades === 'function' && typeof provider.listYears === 'function';
  }

  /**
   * Grades are a MyGES/Kordis capability. Prefer the active provider when it exposes them,
   * otherwise fall back to any registered provider that does (so the bulletin works even
   * when the calendar-facing active provider is myEfrei/Ensup).
   */
  private async getCapableProvider(): Promise<AcademicProvider> {
    const active = await this.providerRegistry.getActiveProvider();

    if (GradesService.isCapable(active)) {
      return active;
    }

    const fallback = this.providerRegistry.getProviders().find((provider) => GradesService.isCapable(provider));

    if (!fallback) {
      throw new AppError(
        `Provider "${active.id}" does not expose academic grades.`,
        400,
        'GRADES_NOT_SUPPORTED',
      );
    }

    return fallback;
  }

  async listYears(): Promise<string[]> {
    const provider = await this.getCapableProvider();

    return provider.listYears!();
  }

  /** Build a structured bulletin for a year (defaults to the most recent enrolled year). */
  async getBulletin(requestedYear?: string): Promise<Bulletin> {
    const provider = await this.getCapableProvider();
    const availableYears = await provider.listYears!();
    const sortedYears = [...availableYears].sort((a, b) => Number(b) - Number(a));
    const year = requestedYear ?? sortedYears[0];

    if (!year) {
      throw new AppError('No academic year is available for this account.', 404, 'GRADES_NO_YEAR');
    }

    const raw = await provider.fetchGrades!(year);

    return this.buildBulletin(provider.id, year, availableYears, raw);
  }

  /** Pure aggregation — exposed for testing and reuse. */
  buildBulletin(
    providerId: string,
    year: string,
    availableYears: string[],
    raw: ProviderGradePayload[],
  ): Bulletin {
    const byTrimester = new Map<string, { name: string; courses: BulletinCourse[] }>();

    for (const grade of raw ?? []) {
      const key = String(grade.trimester ?? '');
      const bucket = byTrimester.get(key) ?? {
        name: (grade.trimester_name ?? '').toString().trim() || key,
        courses: [],
      };

      bucket.courses.push({
        course: (grade.course ?? '').toString().trim(),
        teacher: fullTeacher(grade),
        coef: toNumber(grade.coef),
        ects: toNumber(grade.ects),
        continuous: (grade.grades ?? []).map(toNumber),
        exam: toNumber(grade.exam),
        average: effectiveAverage(grade),
      });

      byTrimester.set(key, bucket);
    }

    const trimesters: BulletinTrimester[] = [...byTrimester.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([trimester, bucket]) => ({
        trimester,
        trimesterName: bucket.name,
        courses: bucket.courses,
        average: weightedAverage(bucket.courses),
        ectsTotal: bucket.courses.reduce((sum, course) => sum + (course.ects ?? 0), 0),
        maxContinuous: bucket.courses.reduce((max, course) => Math.max(max, course.continuous.length), 0),
      }));

    const allCourses = trimesters.flatMap((trimester) => trimester.courses);

    return {
      provider: providerId,
      year,
      availableYears: [...availableYears].sort((a, b) => Number(b) - Number(a)),
      trimesters,
      overallAverage: weightedAverage(allCourses),
      ectsTotal: allCourses.reduce((sum, course) => sum + (course.ects ?? 0), 0),
      courseCount: allCourses.length,
    };
  }
}

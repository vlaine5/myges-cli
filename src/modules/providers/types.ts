import type { RangeQuery } from '../events/types';
import type { AcademicProviderId, NormalizedEvent } from '../events/types';

export interface AcademicProviderCredentialInput {
  username?: string;
  password?: string;
  sessionCookie?: string;
  config?: Record<string, unknown>;
}

export interface AcademicProviderStatus {
  provider: AcademicProviderId;
  displayName: string;
  configured: boolean;
  authMode: string | null;
  hasSavedCredentials: boolean;
  hasToken: boolean;
  hasSessionCookie: boolean;
  tokenExpiresAt: string | null;
  lastLoginAt: string | null;
  lastLoginError: string | null;
  config: Record<string, unknown>;
  limitations: string[];
}

export interface AcademicProviderTestResult {
  ok: true;
  profile?: unknown;
  note?: string | null;
}

/**
 * Raw course object as returned by MyGES/Kordis `GET /me/{year}/courses`.
 * For a teacher account these are the courses they teach. Field names mirror the upstream payload.
 */
export interface ProviderCoursePayload {
  year: number;
  name: string;
  teacher?: string | null;
  teacher_id?: number | null;
  trimester?: number | string | null;
  trimester_id?: number | string | null;
  coef?: number | string | null;
  ects?: number | string | null;
  nb_students?: number | null;
  rc_id?: number | null;
  student_group_id?: number | null;
  student_group_name?: string | null;
  school_id?: number | null;
  syllabus_id?: number | string | null;
  has_grades?: boolean | null;
  has_documents?: boolean | null;
}

/**
 * Raw grade object as returned by MyGES/Kordis `GET /me/{year}/grades`.
 * Field names mirror the upstream payload (cf. quantumsheep/myges-cli grades command).
 * `coef`/`ects`/`average`/`exam` may arrive as number or numeric string depending on the course.
 */
export interface ProviderGradePayload {
  year: number;
  trimester: number | string;
  trimester_name?: string;
  course: string;
  teacher_civility?: string | null;
  teacher_first_name?: string | null;
  teacher_last_name?: string | null;
  coef?: number | string | null;
  ects?: number | string | null;
  grades: Array<number | null>;
  average: number | string | null;
  exam: number | string | null;
}

export interface AcademicProvider {
  readonly id: AcademicProviderId;
  readonly displayName: string;
  authenticate(input: AcademicProviderCredentialInput): Promise<AcademicProviderStatus>;
  testConnection(input?: AcademicProviderCredentialInput): Promise<AcademicProviderTestResult>;
  getStatus(): Promise<AcademicProviderStatus>;
  fetchEvents(
    range: RangeQuery,
    options?: { includeRawPayload?: boolean },
  ): Promise<NormalizedEvent[]>;
  /**
   * Optional academic-records capability. Only providers whose backend exposes it
   * (currently MyGES/Kordis) implement these; callers must feature-detect.
   */
  listYears?(): Promise<string[]>;
  fetchGrades?(year: string): Promise<ProviderGradePayload[]>;
  fetchCourses?(year: string): Promise<ProviderCoursePayload[]>;
}

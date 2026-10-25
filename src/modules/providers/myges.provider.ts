import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { decryptSecret } from '../../lib/crypto';
import { normalizeAgendaEvent } from '../events/normalize';
import type { AgendaEventPayload, RangeQuery } from '../events/types';
import { ProviderCredentialStore } from './provider-credential.store';
import type {
  AcademicProvider,
  AcademicProviderCredentialInput,
  AcademicProviderStatus,
  AcademicProviderTestResult,
  ProviderCoursePayload,
  ProviderGradePayload,
} from './types';

interface MyGesAccessToken {
  access_token: string;
  token_type: string;
  expires_in: string;
  scope?: string;
  uid?: string;
}

interface MyGesApiEnvelope<T> {
  result: T;
}

const AUTH_URL =
  'https://authentication.kordis.fr/oauth/authorize?response_type=token&client_id=skolae-app';
const API_BASE_URL = 'https://api.kordis.fr';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function parseTokenFromLocation(location: string): MyGesAccessToken {
  const hash = location.slice(location.indexOf('#') + 1);
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const tokenType = params.get('token_type');
  const expiresIn = params.get('expires_in');

  if (!accessToken || !tokenType || !expiresIn) {
    throw new AppError('MyGES login did not return a usable access token.', 502, 'MYGES_AUTH_INVALID');
  }

  return {
    access_token: accessToken,
    token_type: tokenType,
    expires_in: expiresIn,
    scope: params.get('scope') ?? undefined,
    uid: params.get('uid') ?? undefined,
  };
}

export class MyGesProvider implements AcademicProvider {
  readonly id = 'myges' as const;
  readonly displayName = 'MyGES';
  private readonly store: ProviderCredentialStore;

  constructor(private readonly prisma: PrismaClient) {
    this.store = new ProviderCredentialStore(prisma);
  }

  private async fetchAccessToken(username: string, password: string) {
    const credentials = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    const response = await fetch(AUTH_URL, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      redirect: 'manual',
    });
    const location = response.headers.get('location');

    if (!location) {
      throw new AppError('MyGES credentials were rejected.', 401, 'MYGES_BAD_CREDENTIALS');
    }

    return parseTokenFromLocation(location);
  }

  private async requestWithCredentials<T>(
    path: string,
    credentials: { accessToken: string; tokenType: string },
    retry = true,
  ): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Authorization: `${credentials.tokenType} ${credentials.accessToken}`,
      },
    });

    if (response.status === 401 && retry) {
      const refreshed = await this.ensureAccessToken(true);

      return this.requestWithCredentials<T>(path, refreshed, false);
    }

    if (!response.ok) {
      throw new AppError(
        `MyGES request failed on ${path}.`,
        response.status,
        'MYGES_REQUEST_FAILED',
        await response.text(),
      );
    }

    const payload = (await response.json()) as MyGesApiEnvelope<T>;

    return payload.result;
  }

  private async ensureAccessToken(
    forceRefresh = false,
  ): Promise<{ accessToken: string; tokenType: string }> {
    const credential = await this.store.get(this.id);

    if (!credential?.username || !credential.passwordEncrypted) {
      throw new AppError('MyGES credentials are not configured.', 409, 'MYGES_NOT_CONFIGURED');
    }

    const isTokenStillValid =
      credential.accessToken &&
      credential.tokenType &&
      credential.accessTokenExpiresAt &&
      credential.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS;

    if (isTokenStillValid && !forceRefresh) {
      return {
        accessToken: credential.accessToken!,
        tokenType: credential.tokenType!,
      };
    }

    const password = decryptSecret(credential.passwordEncrypted);

    if (!password) {
      throw new AppError('MyGES password is not available in local storage.', 409, 'MYGES_PASSWORD_MISSING');
    }

    const token = await this.fetchAccessToken(credential.username, password);
    await this.store.upsert(this.id, {
      authMode: 'password',
      username: credential.username,
      password,
      accessToken: token.access_token,
      tokenType: token.token_type,
      accessTokenExpiresAt: new Date(Date.now() + Number.parseInt(token.expires_in, 10) * 1000),
      lastLoginAt: new Date(),
      lastLoginError: null,
      config: this.store.getConfig(credential),
      sessionCookie: this.store.getSessionCookie(credential),
    });

    return {
      accessToken: token.access_token,
      tokenType: token.token_type,
    };
  }

  private async buildStatus(): Promise<AcademicProviderStatus> {
    const credential = await this.store.get(this.id);
    const config = credential ? this.store.getConfig(credential) : {};
    const hasIcsUrl = typeof config.icsUrl === 'string' && config.icsUrl.trim().length > 0;

    return {
      provider: this.id,
      displayName: this.displayName,
      configured: hasIcsUrl || Boolean(credential?.username && credential?.passwordEncrypted),
      authMode: credential?.authMode ?? null,
      hasSavedCredentials: hasIcsUrl || Boolean(credential?.username || credential?.passwordEncrypted),
      hasToken: Boolean(credential?.accessToken && credential?.tokenType),
      hasSessionCookie: Boolean(credential?.sessionCookieEncrypted),
      tokenExpiresAt: credential?.accessTokenExpiresAt?.toISOString() ?? null,
      lastLoginAt: credential?.lastLoginAt?.toISOString() ?? null,
      lastLoginError: credential?.lastLoginError ?? null,
      config: credential ? this.store.getConfig(credential) : {},
      limitations: [],
    };
  }

  async authenticate(input: AcademicProviderCredentialInput) {
    if (!input.username || !input.password) {
      throw new AppError('MyGES requires a username and password.', 400, 'MYGES_CREDENTIALS_REQUIRED');
    }

    const token = await this.fetchAccessToken(input.username, input.password);
    const existing = await this.store.get(this.id);
    // Merge with the existing stored config (notably icsUrl, managed separately
    // via PATCH /config) rather than replacing it wholesale — saving credentials
    // here must never silently wipe out an ICS URL configured elsewhere.
    const mergedConfig = { ...(existing ? this.store.getConfig(existing) : {}), ...(input.config ?? {}) };
    await this.store.upsert(this.id, {
      authMode: 'password',
      username: input.username,
      password: input.password,
      accessToken: token.access_token,
      tokenType: token.token_type,
      accessTokenExpiresAt: new Date(Date.now() + Number.parseInt(token.expires_in, 10) * 1000),
      config: mergedConfig,
      lastLoginAt: new Date(),
      lastLoginError: null,
    });

    return this.buildStatus();
  }

  async testConnection(input?: AcademicProviderCredentialInput): Promise<AcademicProviderTestResult> {
    if (input?.username && input.password) {
      const token = await this.fetchAccessToken(input.username, input.password);
      const profile = await this.requestWithCredentials('/me/profile', {
        accessToken: token.access_token,
        tokenType: token.token_type,
      });

      return {
        ok: true,
        profile,
      };
    }

    const profile = await this.requestWithCredentials('/me/profile', await this.ensureAccessToken());

    return {
      ok: true,
      profile,
    };
  }

  async getStatus() {
    return this.buildStatus();
  }

  async fetchEvents(range: RangeQuery, options: { includeRawPayload?: boolean } = {}) {
    const events = await this.requestWithCredentials<AgendaEventPayload[]>(
      `/me/agenda?start=${range.start.valueOf()}&end=${range.end.valueOf()}`,
      await this.ensureAccessToken(),
    );

    return events.map((event) => normalizeAgendaEvent(event, this.id, options));
  }

  /** Academic years the student is enrolled in (e.g. ['2024', '2025']). */
  async listYears(): Promise<string[]> {
    const years = await this.requestWithCredentials<Array<string | number>>(
      '/me/years',
      await this.ensureAccessToken(),
    );

    return (years ?? []).map((year) => String(year));
  }

  /** Raw grades for a given academic year (`GET /me/{year}/grades`). Student role only. */
  async fetchGrades(year: string): Promise<ProviderGradePayload[]> {
    const grades = await this.requestWithCredentials<ProviderGradePayload[]>(
      `/me/${encodeURIComponent(year)}/grades`,
      await this.ensureAccessToken(),
    );

    return grades ?? [];
  }

  /** Courses for a given academic year (`GET /me/{year}/courses`). Taught courses for a teacher. */
  async fetchCourses(year: string): Promise<ProviderCoursePayload[]> {
    const courses = await this.requestWithCredentials<ProviderCoursePayload[]>(
      `/me/${encodeURIComponent(year)}/courses`,
      await this.ensureAccessToken(),
    );

    return courses ?? [];
  }
}

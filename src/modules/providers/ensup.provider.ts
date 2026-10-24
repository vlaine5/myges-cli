import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { sha256 } from '../../lib/hash';
import { buildNormalizedEvent } from '../events/normalize';
import type { NormalizedEvent, RangeQuery } from '../events/types';
import { ProviderCredentialStore } from './provider-credential.store';
import type {
  AcademicProvider,
  AcademicProviderCredentialInput,
  AcademicProviderStatus,
  AcademicProviderTestResult,
} from './types';

const ENSUP_BASE_URL = 'https://extranet-hp-sqy.ensup.eu';
const ENSUP_LOGIN_URL = `${ENSUP_BASE_URL}/authentication/signIn`;
const ENSUP_PROFILE_URL = `${ENSUP_BASE_URL}/user/current`;

interface EnsupConfig extends Record<string, unknown> {
  agendaEndpoint: string | null;
  icsUrl: string | null;
  nbStudents?: number | null;
}

function parseEnsupConfig(config: Record<string, unknown>): EnsupConfig {
  return {
    ...config,
    agendaEndpoint: typeof config.agendaEndpoint === 'string' ? config.agendaEndpoint : null,
    icsUrl: typeof config.icsUrl === 'string' ? config.icsUrl : null,
    nbStudents: typeof config.nbStudents === 'number' ? config.nbStudents : null,
  };
}

function sanitizeConfig(config: Record<string, unknown>): EnsupConfig {
  const parsed = parseEnsupConfig(config);

  return {
    agendaEndpoint: parsed.agendaEndpoint,
    icsUrl: null,
    nbStudents: parsed.nbStudents ?? null,
    hasIcsUrl: Boolean(parsed.icsUrl),
  };
}

/**
 * Merge new config input onto the existing stored (raw, unsanitized) config.
 * Used anywhere credentials are persisted so an icsUrl configured via
 * PATCH /config is never silently dropped — sanitizeConfig() must only be
 * used for the outward status display, never for what gets persisted.
 */
function mergeConfig(existingRaw: Record<string, unknown>, incoming: Record<string, unknown> | undefined): EnsupConfig {
  const existing = parseEnsupConfig(existingRaw);
  const input = incoming ?? {};

  return {
    ...existing,
    agendaEndpoint: typeof input.agendaEndpoint === 'string' ? input.agendaEndpoint : existing.agendaEndpoint,
    icsUrl: typeof input.icsUrl === 'string' ? input.icsUrl : existing.icsUrl,
    nbStudents: typeof input.nbStudents === 'number' ? input.nbStudents : existing.nbStudents ?? null,
  };
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getDateCandidate(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function getArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) =>
      typeof entry === 'string' ? entry.trim() : typeof entry === 'object' && entry !== null
        ? getString((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label)
        : null,
    )
    .filter((entry): entry is string => Boolean(entry));
}

function buildStableSourceId(record: Record<string, unknown>): string {
  const explicitId =
    getString(record.id) ??
    getString(record.eventId) ??
    getString(record.uid) ??
    getString(record.planningId);

  if (explicitId) {
    return `ensup:${explicitId}`;
  }

  return sha256(
    JSON.stringify([
      getString(record.subject) ??
        getString(record.matiere) ??
        getString(record.name) ??
        getString(record.title),
      getDateCandidate(record.startDate) ?? getDateCandidate(record.start) ?? getDateCandidate(record.debut),
      getDateCandidate(record.endDate) ?? getDateCandidate(record.end) ?? getDateCandidate(record.fin),
      getString(record.room) ?? getString(record.salle) ?? getString(record.location),
      getString(record.group) ?? getString(record.classe) ?? getString(record.promotion),
    ]),
  );
}

function inferPayloadEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;

    for (const key of ['events', 'items', 'result', 'data', 'planning', 'cours', 'seances']) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
  }

  throw new AppError(
    'Ensup HyperPlanning agenda response did not contain an events array.',
    502,
    'ENSUP_EVENTS_INVALID',
  );
}

function normalizeEnsupEvent(item: unknown, includeRawPayload = false): NormalizedEvent {
  if (!item || typeof item !== 'object') {
    throw new AppError('Ensup returned an invalid event item.', 502, 'ENSUP_EVENT_INVALID');
  }

  const record = item as Record<string, unknown>;
  const sourceId = buildStableSourceId(record);

  const title =
    getString(record.name) ??
    getString(record.title) ??
    getString(record.subject) ??
    getString(record.matiere) ??
    getString(record.libelle) ??
    'Cours';

  const startAt =
    getDateCandidate(record.startDate) ??
    getDateCandidate(record.start) ??
    getDateCandidate(record.debut) ??
    getDateCandidate(record.start_date);

  const endAt =
    getDateCandidate(record.endDate) ??
    getDateCandidate(record.end) ??
    getDateCandidate(record.fin) ??
    getDateCandidate(record.end_date);

  if (!startAt || !endAt) {
    throw new AppError(
      `Ensup event ${sourceId} is missing start/end information.`,
      502,
      'ENSUP_EVENT_DATES_MISSING',
    );
  }

  const teacher =
    getString(record.teacher) ??
    getString(record.enseignant) ??
    getString(record.intervenant) ??
    getString(record.teacherName);

  const rawRoom =
    getString(record.room) ??
    getString(record.salle) ??
    getString(record.location) ??
    getString(record.roomName);

  const rawClasses = getArrayOfStrings(
    record.groups ?? record.classes ?? record.groupes ?? record.promotions ?? record.eleves,
  );

  const promotion =
    getString(record.promotion) ??
    getString(record.promo) ??
    rawClasses[0] ??
    null;

  const studentCount =
    getNumber(record.studentCount) ??
    getNumber(record.nb_students) ??
    getNumber(record.nbStudents) ??
    getNumber(record.effectif) ??
    getNumber(record.nbEleves);

  return buildNormalizedEvent({
    provider: 'ensup',
    sourceId,
    reservationId: getNumber(record.id) ?? getNumber(record.eventId) ?? getNumber(record.planningId),
    title,
    subject: getString(record.subject) ?? getString(record.matiere) ?? title,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    teacher,
    room: rawRoom,
    campus: getString(record.campus) ?? getString(record.site) ?? null,
    rooms: rawRoom
      ? [
          {
            name: rawRoom,
            floor: null,
            campus: getString(record.campus) ?? getString(record.site) ?? null,
            address: null,
          },
        ]
      : [],
    promotion,
    group: getString(record.group) ?? getString(record.classe) ?? rawClasses[0] ?? null,
    classes: rawClasses,
    modality: getString(record.modality) ?? getString(record.modalite) ?? null,
    reservationType: getString(record.type) ?? getString(record.typeSeance) ?? null,
    studentCount,
    disciplineName: getString(record.matiere) ?? getString(record.subject) ?? null,
    disciplineTeacher: teacher,
    disciplineId: getNumber(record.disciplineId) ?? getNumber(record.matiereId) ?? null,
    rawPayload: includeRawPayload ? JSON.stringify(record) : null,
  });
}

function extractSessionCookies(headers: Headers): string {
  const cookies: string[] = [];
  const rawSetCookie = headers.get('set-cookie') ?? '';

  if (!rawSetCookie) {
    return '';
  }

  // Split multiple Set-Cookie headers
  const cookieStrings = rawSetCookie
    .split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/g)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const cookieStr of cookieStrings) {
    const nameValue = cookieStr.split(';')[0]?.trim();

    if (nameValue) {
      cookies.push(nameValue);
    }
  }

  return cookies.join('; ');
}

function normalizeSessionCookieHeader(raw: string): string {
  const SKIP_ATTRS = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly', 'priority']);
  const cookies = new Map<string, string>();
  const parts = raw
    .replace(/\r?\n/g, ';')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  for (let part of parts) {
    if (part.toLowerCase().startsWith('cookie:')) {
      part = part.slice('cookie:'.length).trim();
    }

    if (!part.includes('=')) {
      continue;
    }

    const [rawName, ...rawValueParts] = part.split('=');
    const name = rawName?.trim();
    const value = rawValueParts.join('=').trim();

    if (!name || !value || SKIP_ATTRS.has(name.toLowerCase())) {
      continue;
    }

    cookies.set(name, value);
  }

  return [...cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function getRangeForConnectivityProbe(): RangeQuery {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 30);

  return { start, end };
}

export class EnsupProvider implements AcademicProvider {
  readonly id = 'ensup' as const;
  readonly displayName = 'Ensup (HyperPlanning)';
  private readonly store: ProviderCredentialStore;

  constructor(private readonly prisma: PrismaClient) {
    this.store = new ProviderCredentialStore(prisma);
  }

  private async fetchWithSession(sessionCookie: string, url: string, init: RequestInit = {}) {
    return fetch(url, {
      ...init,
      headers: {
        Cookie: sessionCookie,
        Accept: 'application/json, text/html, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
        ...(init.headers ?? {}),
      },
      redirect: 'manual',
    });
  }

  private async testSessionCookie(sessionCookie: string): Promise<AcademicProviderTestResult> {
    // Try to reach the profile endpoint or the base URL
    const response = await this.fetchWithSession(sessionCookie, ENSUP_PROFILE_URL);

    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        'Ensup session cookie is invalid or expired.',
        401,
        'ENSUP_SESSION_EXPIRED',
      );
    }

    if (response.ok) {
      return { ok: true, note: 'Ensup session active.' };
    }

    // Try fallback to base URL
    const baseResponse = await this.fetchWithSession(sessionCookie, ENSUP_BASE_URL);

    if (baseResponse.status === 401 || baseResponse.status === 403) {
      throw new AppError(
        'Ensup session cookie is invalid or expired.',
        401,
        'ENSUP_SESSION_EXPIRED',
      );
    }

    return { ok: true, note: 'Ensup session appears active (profile endpoint returned non-200).' };
  }

  private async authenticateWithPassword(username: string, password: string): Promise<string> {
    // Try form-based POST to HyperPlanning login endpoint
    const loginResponse = await fetch(ENSUP_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
        Accept: 'text/html,application/xhtml+xml,*/*',
        Origin: ENSUP_BASE_URL,
        Referer: ENSUP_BASE_URL,
      },
      body: new URLSearchParams({
        login: username,
        password,
        // HyperPlanning Online common field names
        username,
        pwd: password,
      }).toString(),
      redirect: 'manual',
    });

    const sessionCookie = extractSessionCookies(loginResponse.headers);

    // Check if we got redirected (success) or stayed (failure)
    if (loginResponse.status === 302 || loginResponse.status === 301) {
      if (sessionCookie) {
        return sessionCookie;
      }
    }

    if (loginResponse.ok && sessionCookie) {
      // Verify the session actually works
      const profile = await this.fetchWithSession(sessionCookie, ENSUP_PROFILE_URL);

      if (profile.ok || profile.status !== 401) {
        return sessionCookie;
      }
    }

    throw new AppError(
      'Ensup login failed. Check your username/password or use a session cookie instead.',
      401,
      'ENSUP_AUTH_FAILED',
    );
  }

  private async ensureSessionCookie(forceRefresh = false): Promise<string> {
    const credential = await this.store.get(this.id);

    if (!credential) {
      throw new AppError(
        'No Ensup credentials configured. Set a session cookie or username/password.',
        409,
        'ENSUP_NOT_CONFIGURED',
      );
    }

    if (!forceRefresh && credential.sessionCookieEncrypted) {
      return this.store.getSessionCookie(credential) as string;
    }

    if (credential.username && credential.passwordEncrypted) {
      const password = this.store.getPassword(credential) as string;
      const sessionCookie = await this.authenticateWithPassword(credential.username, password);

      await this.store.upsert(this.id, {
        authMode: 'password+session_cookie',
        username: credential.username,
        password,
        sessionCookie,
        lastLoginAt: new Date(),
        lastLoginError: null,
      });

      return sessionCookie;
    }

    throw new AppError(
      'No valid Ensup credentials. Set a session cookie in provider config.',
      409,
      'ENSUP_NOT_CONFIGURED',
    );
  }

  private async fetchAgendaPayload(
    sessionCookie: string,
    agendaEndpoint: string,
    range: RangeQuery,
  ): Promise<unknown> {
    const startIso = range.start.toISOString().slice(0, 10);
    const endIso = range.end.toISOString().slice(0, 10);

    // Build URL with common HyperPlanning query parameters
    const url = new URL(agendaEndpoint);

    if (!url.searchParams.has('start') && !url.searchParams.has('startDate') && !url.searchParams.has('debut')) {
      url.searchParams.set('start', startIso);
      url.searchParams.set('end', endIso);
    }

    const response = await this.fetchWithSession(sessionCookie, url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        'Ensup session expired while fetching agenda.',
        401,
        'ENSUP_SESSION_EXPIRED',
      );
    }

    if (!response.ok) {
      throw new AppError(
        `Ensup agenda endpoint returned HTTP ${response.status}.`,
        502,
        'ENSUP_AGENDA_ERROR',
      );
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      return response.json();
    }

    // Try JSON parse even if content-type is wrong
    const text = await response.text();

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AppError(
        'Ensup agenda endpoint did not return JSON. Configure the correct agenda endpoint in provider config.',
        502,
        'ENSUP_AGENDA_NOT_JSON',
      );
    }
  }

  private async buildStatus(): Promise<AcademicProviderStatus> {
    const credential = await this.store.get(this.id);
    const hasIcsUrl = Boolean(credential && parseEnsupConfig(this.store.getConfig(credential)).icsUrl);

    return {
      provider: this.id,
      displayName: this.displayName,
      configured:
        hasIcsUrl ||
        Boolean(
          credential?.sessionCookieEncrypted ||
            (credential?.username && credential?.passwordEncrypted),
        ),
      authMode: credential?.authMode ?? null,
      hasSavedCredentials:
        hasIcsUrl ||
        Boolean(
          credential?.username ||
            credential?.passwordEncrypted ||
            credential?.sessionCookieEncrypted,
        ),
      hasToken: false,
      hasSessionCookie: Boolean(credential?.sessionCookieEncrypted),
      tokenExpiresAt: null,
      lastLoginAt: credential?.lastLoginAt?.toISOString() ?? null,
      lastLoginError: credential?.lastLoginError ?? null,
      config: credential ? sanitizeConfig(this.store.getConfig(credential)) : {},
      limitations: [
        'HyperPlanning authentication may require a session cookie copied from your browser.',
        'Set the agenda endpoint URL (JSON planning endpoint) in provider config.',
        'The session cookie expires periodically — update it when sync fails.',
      ],
    };
  }

  async authenticate(input: AcademicProviderCredentialInput): Promise<AcademicProviderStatus> {
    const existing = await this.store.get(this.id);
    const config = mergeConfig(existing ? this.store.getConfig(existing) : {}, input.config);

    if (input.sessionCookie) {
      const normalizedCookie = normalizeSessionCookieHeader(input.sessionCookie);
      await this.testSessionCookie(normalizedCookie);
      await this.store.upsert(this.id, {
        authMode: 'session_cookie',
        username: input.username ?? null,
        sessionCookie: normalizedCookie,
        config,
        lastLoginAt: new Date(),
        lastLoginError: null,
      });

      return this.buildStatus();
    }

    if (input.username && input.password) {
      const sessionCookie = await this.authenticateWithPassword(input.username, input.password);
      await this.store.upsert(this.id, {
        authMode: 'password+session_cookie',
        username: input.username,
        password: input.password,
        sessionCookie,
        config,
        lastLoginAt: new Date(),
        lastLoginError: null,
      });

      return this.buildStatus();
    }

    throw new AppError(
      'Ensup requires either a session cookie or a username/password pair.',
      400,
      'ENSUP_CREDENTIALS_REQUIRED',
    );
  }

  async testConnection(input?: AcademicProviderCredentialInput): Promise<AcademicProviderTestResult> {
    const config = sanitizeConfig(input?.config ?? {});

    if (input?.sessionCookie) {
      const normalizedCookie = normalizeSessionCookieHeader(input.sessionCookie);
      const sessionResult = await this.testSessionCookie(normalizedCookie);

      if (config.agendaEndpoint) {
        const payload = await this.fetchAgendaPayload(
          normalizedCookie,
          config.agendaEndpoint,
          getRangeForConnectivityProbe(),
        );
        const events = inferPayloadEvents(payload);

        return {
          ...sessionResult,
          note: `Ensup session active. Agenda endpoint accessible (${events.length} événement(s) retournés).`,
        };
      }

      return {
        ...sessionResult,
        note: 'Session Ensup active. Configurez également l\'endpoint agenda pour récupérer les événements.',
      };
    }

    if (input?.username && input.password) {
      const sessionCookie = await this.authenticateWithPassword(input.username, input.password);
      const sessionResult = await this.testSessionCookie(sessionCookie);

      if (config.agendaEndpoint) {
        const payload = await this.fetchAgendaPayload(
          sessionCookie,
          config.agendaEndpoint,
          getRangeForConnectivityProbe(),
        );
        const events = inferPayloadEvents(payload);

        return {
          ...sessionResult,
          note: `Connexion Ensup réussie. Agenda accessible (${events.length} événement(s)).`,
        };
      }

      return sessionResult;
    }

    // Use saved credentials
    const sessionCookie = await this.ensureSessionCookie();

    try {
      const sessionResult = await this.testSessionCookie(sessionCookie);
      const credential = await this.store.get(this.id);
      const storedConfig = credential
        ? parseEnsupConfig(this.store.getConfig(credential))
        : { agendaEndpoint: null };

      if (storedConfig.agendaEndpoint) {
        const payload = await this.fetchAgendaPayload(
          sessionCookie,
          storedConfig.agendaEndpoint,
          getRangeForConnectivityProbe(),
        );
        const events = inferPayloadEvents(payload);

        return {
          ...sessionResult,
          note: `Session Ensup active. Endpoint agenda configuré (${events.length} événement(s)).`,
        };
      }

      return {
        ...sessionResult,
        note: 'Session Ensup active. Configurez l\'endpoint agenda dans la config du provider.',
      };
    } catch (error) {
      if (error instanceof AppError && error.code === 'ENSUP_SESSION_EXPIRED') {
        const refreshed = await this.ensureSessionCookie(true);

        if (refreshed !== sessionCookie) {
          return this.testSessionCookie(refreshed);
        }
      }

      throw error;
    }
  }

  async getStatus(): Promise<AcademicProviderStatus> {
    return this.buildStatus();
  }

  async fetchEvents(range: RangeQuery, options: { includeRawPayload?: boolean } = {}): Promise<NormalizedEvent[]> {
    const credential = await this.store.get(this.id);
    const config = credential ? parseEnsupConfig(this.store.getConfig(credential)) : { agendaEndpoint: null };

    if (!config.agendaEndpoint) {
      throw new AppError(
        'Ensup nécessite un `agendaEndpoint` dans la config du provider pour récupérer les événements.',
        409,
        'ENSUP_ENDPOINT_NOT_CONFIGURED',
      );
    }

    const sessionCookie = await this.ensureSessionCookie();
    const payload = await this.fetchAgendaPayload(sessionCookie, config.agendaEndpoint, range);

    return inferPayloadEvents(payload).map((item) =>
      normalizeEnsupEvent(item, options.includeRawPayload),
    );
  }
}

import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { sha256 } from '../../lib/hash';
import { buildNormalizedEvent } from '../events/normalize';
import { parseStructuredDescription } from '../events/structured-description';
import type { NormalizedEvent, RangeQuery } from '../events/types';
import { ProviderCredentialStore } from './provider-credential.store';
import type {
  AcademicProvider,
  AcademicProviderCredentialInput,
  AcademicProviderStatus,
  AcademicProviderTestResult,
} from './types';

const MYEFREI_BASE_URL = 'https://www.myefrei.fr';
const MYEFREI_AUTH_START_URL = `${MYEFREI_BASE_URL}/auth/efrei`;
const COOKIE_ATTRIBUTE_NAMES = new Set([
  'path',
  'domain',
  'expires',
  'max-age',
  'samesite',
  'secure',
  'httponly',
  'priority',
]);

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
}

function parseSetCookie(cookieHeader: string, requestUrl: string): CookieEntry | null {
  const [nameValue, ...attributes] = cookieHeader.split(';');
  if (!nameValue) {
    return null;
  }
  const [rawName, ...rawValueParts] = nameValue.split('=');
  const name = rawName?.trim();
  const value = rawValueParts.join('=').trim();

  if (!name || !value) {
    return null;
  }

  const url = new URL(requestUrl);
  let domain = url.hostname;
  let path = '/';
  let hostOnly = true;
  let secure = false;

  for (const rawAttribute of attributes) {
    const [rawKey, rawAttributeValue] = rawAttribute.split('=');
    const key = rawKey?.trim().toLowerCase();
    const attributeValue = rawAttributeValue?.trim();

    if (key === 'domain' && attributeValue) {
      domain = attributeValue.replace(/^\./, '');
      hostOnly = false;
    }

    if (key === 'path' && attributeValue) {
      path = attributeValue;
    }

    if (key === 'secure') {
      secure = true;
    }
  }

  return {
    name,
    value,
    domain,
    path,
    hostOnly,
    secure,
  };
}

function splitSetCookieHeader(rawHeader: string) {
  if (!rawHeader) {
    return [];
  }

  return rawHeader
    .split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/g)
    .map((cookie) => cookie.trim())
    .filter(Boolean);
}

function extractCookieEntries(headers: Headers, requestUrl: string) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const rawCookies = getSetCookie
    ? getSetCookie.call(headers)
    : splitSetCookieHeader(headers.get('set-cookie') ?? '');

  return rawCookies
    .filter(Boolean)
    .map((cookie) => parseSetCookie(cookie, requestUrl))
    .filter((cookie): cookie is CookieEntry => Boolean(cookie));
}

function domainMatches(hostname: string, cookie: CookieEntry) {
  if (cookie.hostOnly) {
    return hostname === cookie.domain;
  }

  return hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
}

function mergeCookies(existing: CookieEntry[], incoming: CookieEntry[]) {
  const jar = new Map<string, CookieEntry>();

  for (const cookie of [...existing, ...incoming]) {
    jar.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
  }

  return [...jar.values()];
}

function getCookieHeader(cookies: CookieEntry[], requestUrl: string) {
  const url = new URL(requestUrl);

  return cookies
    .filter((cookie) => domainMatches(url.hostname, cookie))
    .filter((cookie) => url.pathname.startsWith(cookie.path))
    .filter((cookie) => !cookie.secure || url.protocol === 'https:')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function parseMyEfreiConfig(config: Record<string, unknown>) {
  return {
    agendaEndpoint: typeof config.agendaEndpoint === 'string' ? config.agendaEndpoint : null,
    icsUrl: typeof config.icsUrl === 'string' ? config.icsUrl : null,
  };
}

function isAuthRedirect(response: Response) {
  const location = response.headers.get('location') ?? '';

  return response.status >= 300 && response.status < 400 && location.includes('/auth/efrei');
}

function sanitizeConfig(config: Record<string, unknown>) {
  const parsed = parseMyEfreiConfig(config);

  return {
    agendaEndpoint: parsed.agendaEndpoint,
    hasIcsUrl: Boolean(parsed.icsUrl),
  };
}

function normalizeSessionCookieHeader(rawCookieHeader: string) {
  const cookies = new Map<string, string>();
  const parts = rawCookieHeader
    .replace(/\r?\n/g, ';')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  for (let part of parts) {
    if (part.toLowerCase().startsWith('cookie:')) {
      part = part.slice('cookie:'.length).trim();
    }

    if (!part || !part.includes('=')) {
      continue;
    }

    const [rawName, ...rawValueParts] = part.split('=');
    const name = rawName?.trim();
    const value = rawValueParts.join('=').trim();

    if (!name || !value || COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase())) {
      continue;
    }

    cookies.set(name, value);
  }

  return [...cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function assertSessionCookieLooksUsable(sessionCookie: string) {
  const hasSessionId = sessionCookie
    .split(';')
    .map((part) => part.trim().split('=')[0]?.trim().toLowerCase())
    .includes('myefrei.sid');

  if (!hasSessionId) {
    throw new AppError(
      'The myEfrei session cookie must include at least `myefrei.sid=...`. Paste the browser Cookie header, not a single Set-Cookie attribute.',
      400,
      'MYEFREI_COOKIE_FORMAT_INVALID',
    );
  }
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getDateCandidate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const asNumber = Number(value);

    if (Number.isFinite(asNumber) && `${asNumber}` === value.trim()) {
      return asNumber;
    }

    return value;
  }

  return null;
}

function getArrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => getString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function inferPayloadEvents(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;

    for (const key of ['events', 'items', 'result', 'data']) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
  }

  throw new AppError(
    'myEfrei agenda response did not contain an events array.',
    502,
    'MYEFREI_EVENTS_INVALID',
  );
}

function buildStableSourceId(record: Record<string, unknown>, discipline: Record<string, unknown>) {
  const structured = parseStructuredDescription(
    getString(record.description) ??
      getString(record.details) ??
      getString(record.notes),
  );
  const explicitId =
    getString(record.id) ??
    getString(record.eventId) ??
    getString(record.uid) ??
    getString(record.reservation_id);

  if (explicitId) {
    return explicitId;
  }

  return sha256(
    JSON.stringify([
      getString(record.subject) ??
        getString(discipline.name) ??
        structured.moduleCode ??
        getString(record.title) ??
        getString(record.name),
      getDateCandidate(record.startAt) ??
        getDateCandidate(record.start) ??
        getDateCandidate(record.start_date) ??
        getDateCandidate(record.startDate),
      getDateCandidate(record.endAt) ??
        getDateCandidate(record.end) ??
        getDateCandidate(record.end_date) ??
        getDateCandidate(record.endDate),
      getString(record.teacher) ??
        getString(record.teacherName) ??
        getString(record.lecturer) ??
        getString(discipline.teacher) ??
        structured.teacher,
      getString(record.room) ??
        getString(record.roomName) ??
        getString(record.location) ??
        structured.room,
      getString(record.group) ??
        getString(record.class) ??
        getString(record.studentGroup) ??
        getString(discipline.student_group_name) ??
        structured.groups[0] ??
        getString(record.promotion),
    ]),
  );
}

export function normalizeMyEfreiEvent(item: unknown, includeRawPayload = false): NormalizedEvent {
  if (!item || typeof item !== 'object') {
    throw new AppError('myEfrei returned an invalid event item.', 502, 'MYEFREI_EVENT_INVALID');
  }

  const record = item as Record<string, unknown>;
  const discipline = (record.discipline ?? {}) as Record<string, unknown>;
  const structured = parseStructuredDescription(
    getString(record.description) ??
      getString(record.details) ??
      getString(record.notes),
  );
  const sourceId = buildStableSourceId(record, discipline);
  const title =
    getString(record.title) ??
    getString(record.name) ??
    getString(record.subject) ??
    getString(discipline.name) ??
    'Cours';
  const startAt =
    getDateCandidate(record.startAt) ??
    getDateCandidate(record.start) ??
    getDateCandidate(record.start_date) ??
    getDateCandidate(record.startDate);
  const endAt =
    getDateCandidate(record.endAt) ??
    getDateCandidate(record.end) ??
    getDateCandidate(record.end_date) ??
    getDateCandidate(record.endDate);

  if (!startAt || !endAt) {
    throw new AppError(
      `myEfrei event ${sourceId} is missing start/end information.`,
      502,
      'MYEFREI_EVENT_DATES_MISSING',
    );
  }

  const teacher =
    getString(record.teacher) ??
    getString(record.teacherName) ??
    getString(record.lecturer) ??
    getString(discipline.teacher) ??
    structured.teacher;
  const room =
    getString(record.room) ??
    getString(record.roomName) ??
    getString(record.location) ??
    structured.room;
  const campus = getString(record.campus);
  const classes = [...new Set([
    ...getArrayOfStrings(record.classes),
    ...structured.groups,
  ])];
  const studentCount =
    getNumber(record.studentCount) ??
    getNumber(record.nb_students) ??
    getNumber(record.classSize) ??
    getNumber(discipline.nb_students) ??
    structured.studentCount;

  return buildNormalizedEvent({
    provider: 'myefrei',
    sourceId,
    reservationId:
      getNumber(record.reservationId) ??
      getNumber(record.reservation_id) ??
      getNumber(record.id),
    title,
    subject:
      getString(record.subject) ??
      getString(discipline.name) ??
      structured.moduleCode ??
      structured.subject ??
      title,
    startAt,
    endAt,
    teacher,
    room,
    campus,
    rooms: room
      ? [
          {
            name: room,
            floor: null,
            campus,
            address: null,
          },
        ]
      : [],
    promotion: getString(record.promotion) ?? structured.groups[0] ?? null,
    group:
      getString(record.group) ??
      getString(record.class) ??
      getString(record.studentGroup) ??
      getString(discipline.student_group_name) ??
      structured.groups[0] ??
      classes[0] ??
      null,
    classes,
    modality: getString(record.modality) ?? structured.modality,
    reservationType: getString(record.type) ?? structured.activityType,
    studentCount,
    disciplineName: getString(discipline.name),
    disciplineTeacher: getString(discipline.teacher),
    disciplineId: getNumber(discipline.id) ?? getNumber(discipline.rc_id),
    rawPayload: includeRawPayload ? JSON.stringify(item) : null,
  });
}

export class MyEfreiProvider implements AcademicProvider {
  readonly id = 'myefrei' as const;
  readonly displayName = 'myEfrei';
  private readonly store: ProviderCredentialStore;

  constructor(private readonly prisma: PrismaClient) {
    this.store = new ProviderCredentialStore(prisma);
  }

  private async recordLoginError(message: string) {
    await this.store.upsert(this.id, {
      lastLoginError: message,
    });
  }

  private getRangeForConnectivityProbe() {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setDate(end.getDate() + 30);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  private async fetchAgendaPayload(
    sessionCookie: string,
    agendaEndpoint: string,
    range: RangeQuery,
    retry = true,
  ): Promise<unknown> {
    const endpointUrl = new URL(agendaEndpoint);
    endpointUrl.searchParams.set('start', range.start.toISOString());
    endpointUrl.searchParams.set('end', range.end.toISOString());
    endpointUrl.searchParams.set('startMs', String(range.start.valueOf()));
    endpointUrl.searchParams.set('endMs', String(range.end.valueOf()));

    const response = await fetch(endpointUrl, {
      headers: {
        Cookie: sessionCookie,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
      },
      redirect: 'manual',
    });

    if (isAuthRedirect(response)) {
      if (retry) {
        const refreshedSessionCookie = await this.ensureSessionCookie(true);

        if (refreshedSessionCookie !== sessionCookie) {
          return this.fetchAgendaPayload(refreshedSessionCookie, agendaEndpoint, range, false);
        }
      }

      throw new AppError(
        'The myEfrei session expired while fetching events.',
        401,
        'MYEFREI_SESSION_EXPIRED',
      );
    }

    if (!response.ok) {
      throw new AppError(
        `myEfrei agenda request failed on ${endpointUrl.pathname}.`,
        response.status,
        'MYEFREI_EVENTS_REQUEST_FAILED',
        await response.text(),
      );
    }

    return response.json() as Promise<unknown>;
  }

  private async ensureSessionCookie(forceRefresh = false) {
    const credential = await this.store.get(this.id);

    if (!credential) {
      throw new AppError(
        'myEfrei is not configured. Provide a session cookie or credentials first.',
        409,
        'MYEFREI_NOT_CONFIGURED',
      );
    }

    const storedSessionCookie = this.store.getSessionCookie(credential);
    const normalizedStoredSessionCookie = storedSessionCookie
      ? normalizeSessionCookieHeader(storedSessionCookie)
      : null;

    if (normalizedStoredSessionCookie && !forceRefresh) {
      return normalizedStoredSessionCookie;
    }

    const password = credential.passwordEncrypted
      ? this.store.getPassword(credential)
      : null;

    if (credential.username && password) {
      try {
        const sessionCookie = await this.authenticateWithPassword(credential.username, password);
        await this.store.upsert(this.id, {
          authMode: 'password+session_cookie',
          username: credential.username,
          password,
          sessionCookie,
          config: sanitizeConfig(this.store.getConfig(credential)),
          lastLoginAt: new Date(),
          lastLoginError: null,
        });

        return sessionCookie;
      } catch (error) {
        await this.recordLoginError(
          error instanceof Error ? error.message : 'myEfrei authentication failed.',
        );
        throw error;
      }
    }

    if (normalizedStoredSessionCookie) {
      return normalizedStoredSessionCookie;
    }

    throw new AppError(
      'myEfrei is not fully configured. A session cookie or stored username/password is required.',
      409,
      'MYEFREI_NOT_CONFIGURED',
    );
  }

  private async testSessionCookie(sessionCookie: string): Promise<AcademicProviderTestResult> {
    const normalizedCookie = normalizeSessionCookieHeader(sessionCookie);
    assertSessionCookieLooksUsable(normalizedCookie);

    let requestUrl = `${MYEFREI_BASE_URL}/portal/agenda`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(requestUrl, {
        headers: {
          Cookie: normalizedCookie,
          Accept: 'text/html,application/xhtml+xml,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
        },
        redirect: 'manual',
      });

      if (isAuthRedirect(response)) {
        throw new AppError(
          'myEfrei rejected the session cookie. Make sure you copied the active browser Cookie header containing `myefrei.sid`.',
          401,
          'MYEFREI_SESSION_EXPIRED',
        );
      }

      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        requestUrl = new URL(response.headers.get('location')!, requestUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new AppError(
          'myEfrei rejected the session cookie.',
          response.status,
          'MYEFREI_SESSION_INVALID',
        );
      }

      return {
        ok: true,
        note: 'Authenticated myEfrei portal session detected.',
      };
    }

    throw new AppError(
      'myEfrei did not confirm the pasted session cookie on the agenda portal.',
      401,
      'MYEFREI_SESSION_INVALID',
    );
  }

  private async authenticateWithPassword(username: string, password: string) {
    let cookies: CookieEntry[] = [];
    const start = await fetch(MYEFREI_AUTH_START_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
      },
      redirect: 'manual',
    });
    cookies = mergeCookies(cookies, extractCookieEntries(start.headers, MYEFREI_AUTH_START_URL));
    const authUrl = start.headers.get('location');

    if (!authUrl) {
      throw new AppError('Unable to start myEfrei authentication flow.', 502, 'MYEFREI_AUTH_START_FAILED');
    }

    let formUrl = authUrl;
    let page: Response | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      page = await fetch(formUrl, {
        headers: {
          Cookie: getCookieHeader(cookies, formUrl),
          'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
        },
        redirect: 'manual',
      });
      cookies = mergeCookies(cookies, extractCookieEntries(page.headers, formUrl));

      if (page.status >= 300 && page.status < 400 && page.headers.get('location')) {
        formUrl = new URL(page.headers.get('location')!, formUrl).toString();
        continue;
      }

      break;
    }

    if (!page) {
      throw new AppError('Unable to load the myEfrei login form.', 502, 'MYEFREI_FORM_LOAD_FAILED');
    }

    const html = await page.text();
    const formTagMatch = html.match(/<form[^>]*id="login-form"[^>]*>/i);
    const csrfMatch =
      html.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/i) ??
      html.match(/<input[^>]*value="([^"]+)"[^>]*name="_csrf"/i);

    if (!formTagMatch || !csrfMatch) {
      throw new AppError('Unable to parse the myEfrei login form.', 502, 'MYEFREI_FORM_PARSE_FAILED');
    }

    const actionMatch = formTagMatch[0].match(/action="([^"]+)"/i);

    if (!actionMatch) {
      throw new AppError('Unable to parse the myEfrei login form.', 502, 'MYEFREI_FORM_PARSE_FAILED');
    }

    const formAction = actionMatch[1];
    const csrfToken = csrfMatch[1];

    if (!formAction || !csrfToken) {
      throw new AppError(
        'The myEfrei login form did not expose the expected action or CSRF token.',
        502,
        'MYEFREI_FORM_FIELDS_MISSING',
      );
    }

    const loginResponse = await fetch(new URL(formAction, page.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: getCookieHeader(cookies, page.url),
        'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
      },
      body: new URLSearchParams({
        username,
        password,
        _csrf: csrfToken,
      }).toString(),
      redirect: 'manual',
    });
    cookies = mergeCookies(
      cookies,
      extractCookieEntries(loginResponse.headers, new URL(formAction, page.url).toString()),
    );
    const loginLocation = loginResponse.headers.get('location') ?? '';

    if (loginLocation.includes('?error')) {
      throw new AppError(
        'myEfrei rejected the automated username/password login. The portal uses reCAPTCHA; prefer a valid session cookie.',
        401,
        'MYEFREI_PASSWORD_LOGIN_BLOCKED',
      );
    }

    if (!loginLocation) {
      throw new AppError('myEfrei did not return a post-login redirect.', 502, 'MYEFREI_LOGIN_REDIRECT_MISSING');
    }

    let nextUrl = new URL(loginLocation, page.url).toString();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(nextUrl, {
        headers: {
          Cookie: getCookieHeader(cookies, nextUrl),
          'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
        },
        redirect: 'manual',
      });
      cookies = mergeCookies(cookies, extractCookieEntries(response.headers, nextUrl));

      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        nextUrl = new URL(response.headers.get('location')!, nextUrl).toString();
        continue;
      }

      if (response.ok && response.url.startsWith(MYEFREI_BASE_URL)) {
        return getCookieHeader(cookies, MYEFREI_BASE_URL);
      }

      break;
    }

    throw new AppError(
      'Unable to complete the myEfrei login flow automatically. Configure a session cookie instead.',
      401,
      'MYEFREI_LOGIN_INCOMPLETE',
    );
  }

  private async buildStatus(): Promise<AcademicProviderStatus> {
    const credential = await this.store.get(this.id);

    return {
      provider: this.id,
      displayName: this.displayName,
      configured: Boolean(
        credential?.sessionCookieEncrypted ||
          (credential?.username && credential?.passwordEncrypted),
      ),
      authMode: credential?.authMode ?? null,
      hasSavedCredentials: Boolean(
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
        'myEfrei username/password automation can be blocked by reCAPTCHA.',
        'When needed, use a valid session cookie plus an agenda endpoint in provider config.',
      ],
    };
  }

  async authenticate(input: AcademicProviderCredentialInput) {
    const config = sanitizeConfig(input.config ?? {});

    if (input.sessionCookie) {
      const normalizedSessionCookie = normalizeSessionCookieHeader(input.sessionCookie);
      await this.testSessionCookie(normalizedSessionCookie);
      await this.store.upsert(this.id, {
        authMode: 'session_cookie',
        username: input.username ?? null,
        sessionCookie: normalizedSessionCookie,
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
      'myEfrei requires either a session cookie or a username/password pair.',
      400,
      'MYEFREI_CREDENTIALS_REQUIRED',
    );
  }

  async testConnection(input?: AcademicProviderCredentialInput): Promise<AcademicProviderTestResult> {
    const config = sanitizeConfig(input?.config ?? {});

    if (input?.sessionCookie) {
      const normalizedSessionCookie = normalizeSessionCookieHeader(input.sessionCookie);
      const sessionResult = await this.testSessionCookie(normalizedSessionCookie);

      if (config.agendaEndpoint) {
        const payload = await this.fetchAgendaPayload(
          normalizedSessionCookie,
          config.agendaEndpoint,
          this.getRangeForConnectivityProbe(),
          false,
        );
        const events = inferPayloadEvents(payload);

        return {
          ...sessionResult,
          note: `Authenticated myEfrei session detected. Agenda endpoint reachable (${events.length} event item(s) returned).`,
        };
      }

      return {
        ...sessionResult,
        note: 'Authenticated myEfrei portal session detected. You still need the agenda endpoint to fetch events.',
      };
    }

    if (input?.username && input.password) {
      const sessionCookie = await this.authenticateWithPassword(input.username, input.password);
      const sessionResult = await this.testSessionCookie(sessionCookie);

      if (config.agendaEndpoint) {
        const payload = await this.fetchAgendaPayload(
          sessionCookie,
          config.agendaEndpoint,
          this.getRangeForConnectivityProbe(),
          false,
        );
        const events = inferPayloadEvents(payload);

        return {
          ...sessionResult,
          note: `Authenticated myEfrei session detected. Agenda endpoint reachable (${events.length} event item(s) returned).`,
        };
      }

      return sessionResult;
    }

    const sessionCookie = await this.ensureSessionCookie();

    try {
      const sessionResult = await this.testSessionCookie(sessionCookie);
      const credential = await this.store.get(this.id);
      const storedConfig = credential ? parseMyEfreiConfig(this.store.getConfig(credential)) : { agendaEndpoint: null };

      if (storedConfig.agendaEndpoint) {
        const payload = await this.fetchAgendaPayload(
          sessionCookie,
          storedConfig.agendaEndpoint,
          this.getRangeForConnectivityProbe(),
        );
        const events = inferPayloadEvents(payload);

        return {
          ...sessionResult,
          note: `Authenticated myEfrei session detected. Stored agenda endpoint reachable (${events.length} event item(s) returned).`,
        };
      }

      return {
        ...sessionResult,
        note: 'Authenticated myEfrei portal session detected. Configure the agenda endpoint to fetch events.',
      };
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'MYEFREI_SESSION_EXPIRED'
      ) {
        const refreshedSessionCookie = await this.ensureSessionCookie(true);

        if (refreshedSessionCookie !== sessionCookie) {
          return this.testSessionCookie(refreshedSessionCookie);
        }
      }

      throw error;
    }
  }

  async getStatus() {
    return this.buildStatus();
  }

  async fetchEvents(range: RangeQuery, options: { includeRawPayload?: boolean } = {}) {
    const credential = await this.store.get(this.id);
    const config = credential ? parseMyEfreiConfig(this.store.getConfig(credential)) : { agendaEndpoint: null };

    if (!config.agendaEndpoint) {
      throw new AppError(
        'myEfrei requires an `agendaEndpoint` in provider config to fetch events.',
        409,
        'MYEFREI_ENDPOINT_NOT_CONFIGURED',
      );
    }

    const sessionCookie = await this.ensureSessionCookie();
    const payload = await this.fetchAgendaPayload(sessionCookie, config.agendaEndpoint, range);

    return inferPayloadEvents(payload).map((item) =>
      normalizeMyEfreiEvent(item, options.includeRawPayload),
    );
  }
}

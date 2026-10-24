import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { AcademicProviderId } from '../modules/events/types';

loadDotenv();

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = () =>
  z.preprocess(emptyStringToUndefined, z.string().optional());

const optionalUrl = () =>
  z.preprocess(emptyStringToUndefined, z.string().url().optional());

const resolveFsPath = (rawPath: string) =>
  path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

const resolveDatabaseUrl = (databaseUrl: string) => {
  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const [filePrefix, query = ''] = databaseUrl.slice('file:'.length).split('?');

  if (!filePrefix) {
    return databaseUrl;
  }

  const resolvedPath = resolveFsPath(filePrefix);

  return query.length > 0 ? `file:${resolvedPath}?${query}` : `file:${resolvedPath}`;
};

const booleanLike = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return fallback;
      }

      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const numberLike = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return fallback;
      }

      const parsed = Number.parseInt(value, 10);

      return Number.isFinite(parsed) ? parsed : fallback;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: numberLike(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  APP_SECRET: z.string().min(16).default('development-only-secret-change-me'),
  DATABASE_URL: z
    .string()
    .default(`file:${path.resolve(process.cwd(), 'data/app.db')}`),
  APP_DATA_DIR: z.string().default(path.resolve(process.cwd(), 'data')),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ACADEMIC_PROVIDER: z.enum(['myges', 'myefrei', 'ensup']).default('myges'),
  MYGES_USERNAME: optionalString(),
  MYGES_PASSWORD: optionalString(),
  MYEFREI_USERNAME: optionalString(),
  MYEFREI_PASSWORD: optionalString(),
  MYEFREI_SESSION_COOKIE: optionalString(),
  MYEFREI_AGENDA_ENDPOINT: optionalUrl(),
  ENSUP_USERNAME: optionalString(),
  ENSUP_PASSWORD: optionalString(),
  ENSUP_SESSION_COOKIE: optionalString(),
  ENSUP_AGENDA_ENDPOINT: optionalUrl(),
  ENSUP_ICS_URL: optionalUrl(),
  GOOGLE_CLIENT_ID: optionalString(),
  GOOGLE_CLIENT_SECRET: optionalString(),
  GOOGLE_OAUTH_REDIRECT_URL: optionalUrl(),
  GOOGLE_REDIRECT_URI: optionalUrl(),
  GOOGLE_OAUTH_SCOPES: z
    .string()
    .default('https://www.googleapis.com/auth/calendar'),
  GOOGLE_DEFAULT_CALENDAR_ID: optionalString(),
  GOOGLE_CALENDAR_ID: optionalString(),
  SYNC_ENABLED: booleanLike(false),
  SYNC_LOOKBACK_DAYS: numberLike(7),
  SYNC_LOOKAHEAD_DAYS: numberLike(30),
  SYNC_FUTURE_DAYS: numberLike(30),
  SYNC_FREQUENCY_MINUTES: numberLike(30),
  SYNC_RUN_ON_STARTUP: booleanLike(false),
  RUN_SYNC_ON_STARTUP: booleanLike(false),
  GOOGLE_SYNC_ENABLED: booleanLike(false),
  SAVE_LAST_ICS: booleanLike(true),
  STORE_RAW_PAYLOAD: booleanLike(false),
  TIMEZONE: z.string().default('Europe/Paris'),
});

const parsed = envSchema.parse(process.env);
const resolvedDatabaseUrl = resolveDatabaseUrl(parsed.DATABASE_URL);
const resolvedDataDir = resolveFsPath(parsed.APP_DATA_DIR);

process.env.DATABASE_URL = resolvedDatabaseUrl;

if (parsed.NODE_ENV === 'production' && parsed.APP_SECRET === 'development-only-secret-change-me') {
  throw new Error('APP_SECRET must be configured in production.');
}

export const env = {
  nodeEnv: parsed.NODE_ENV,
  host: parsed.HOST,
  port: parsed.PORT,
  appBaseUrl: parsed.APP_BASE_URL,
  appSecret: parsed.APP_SECRET,
  databaseUrl: resolvedDatabaseUrl,
  dataDir: resolvedDataDir,
  logLevel: parsed.LOG_LEVEL,
  academicProvider: parsed.ACADEMIC_PROVIDER as AcademicProviderId,
  mygesUsername: parsed.MYGES_USERNAME ?? null,
  mygesPassword: parsed.MYGES_PASSWORD ?? null,
  myefreiUsername: parsed.MYEFREI_USERNAME ?? null,
  myefreiPassword: parsed.MYEFREI_PASSWORD ?? null,
  myefreiSessionCookie: parsed.MYEFREI_SESSION_COOKIE ?? null,
  myefreiAgendaEndpoint: parsed.MYEFREI_AGENDA_ENDPOINT ?? null,
  ensupUsername: parsed.ENSUP_USERNAME ?? null,
  ensupPassword: parsed.ENSUP_PASSWORD ?? null,
  ensupSessionCookie: parsed.ENSUP_SESSION_COOKIE ?? null,
  ensupAgendaEndpoint: parsed.ENSUP_AGENDA_ENDPOINT ?? null,
  ensupIcsUrl: parsed.ENSUP_ICS_URL ?? null,
  googleClientId: parsed.GOOGLE_CLIENT_ID ?? null,
  googleClientSecret: parsed.GOOGLE_CLIENT_SECRET ?? null,
  googleOAuthRedirectUrl:
    parsed.GOOGLE_OAUTH_REDIRECT_URL ??
    parsed.GOOGLE_REDIRECT_URI ??
    `${parsed.APP_BASE_URL}/api/google/oauth/callback`,
  googleOAuthScopes: parsed.GOOGLE_OAUTH_SCOPES.split(',')
    .map((scope) => scope.trim())
    .filter(Boolean),
  googleDefaultCalendarId:
    parsed.GOOGLE_DEFAULT_CALENDAR_ID ??
    parsed.GOOGLE_CALENDAR_ID ??
    null,
  syncDefaults: {
    provider: parsed.ACADEMIC_PROVIDER as AcademicProviderId,
    enabled: parsed.SYNC_ENABLED,
    lookbackDays: parsed.SYNC_LOOKBACK_DAYS,
    futureDays:
      process.env.SYNC_FUTURE_DAYS !== undefined
        ? parsed.SYNC_FUTURE_DAYS
        : parsed.SYNC_LOOKAHEAD_DAYS,
    frequencyMinutes: parsed.SYNC_FREQUENCY_MINUTES,
    runOnStartup:
      process.env.SYNC_RUN_ON_STARTUP !== undefined
        ? parsed.SYNC_RUN_ON_STARTUP
        : parsed.RUN_SYNC_ON_STARTUP,
    googleSyncEnabled: parsed.GOOGLE_SYNC_ENABLED,
    saveLastIcs: parsed.SAVE_LAST_ICS,
    storeRawPayload: parsed.STORE_RAW_PAYLOAD,
    timezone: parsed.TIMEZONE,
  },
} as const;

export type Env = typeof env;

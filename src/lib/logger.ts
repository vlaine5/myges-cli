import pino from 'pino';
import { env } from '../config/env';

// Library errors (e.g. Google's gaxios) carry the outgoing request config,
// including the `Authorization: Bearer` header, as enumerable properties —
// pino's default serializer would write that token to the logs. Keep only
// fields that are useful for diagnosis and never carry credentials.
export function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const extra = error as Error & { code?: unknown; status?: unknown; meta?: unknown };

  return {
    type: error.constructor?.name ?? error.name,
    message: error.message,
    stack: error.stack,
    code: extra.code,
    status: extra.status,
    meta: extra.meta,
  };
}

export const logger = pino({
  level: env.logLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: serializeError },
});

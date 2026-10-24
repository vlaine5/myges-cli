import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/env';
import { AppError } from './app-error';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const LEGACY_APP_SECRETS = ['development-only-secret-change-me', 'local-docker-secret-change-me'];

function getKey(secret: string) {
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getKey(env.appSecret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const payload = Buffer.from(value, 'base64');
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const secrets = [env.appSecret, ...LEGACY_APP_SECRETS.filter((secret) => secret !== env.appSecret)];

  for (const secret of secrets) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', getKey(secret), iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      continue;
    }
  }

  throw new AppError('Unable to decrypt local secret storage.', 500, 'SECRET_DECRYPT_FAILED');
}

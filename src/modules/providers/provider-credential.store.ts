import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import type { AcademicProviderId } from '../events/types';

export class ProviderCredentialStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(provider: AcademicProviderId) {
    return this.prisma.academicProviderCredential.findUnique({
      where: { provider },
    });
  }

  async upsert(
    provider: AcademicProviderId,
    data: {
      authMode?: string | null;
      username?: string | null;
      password?: string | null;
      accessToken?: string | null;
      tokenType?: string | null;
      accessTokenExpiresAt?: Date | null;
      sessionCookie?: string | null;
      config?: Record<string, unknown> | null;
      lastLoginAt?: Date | null;
      lastLoginError?: string | null;
    },
  ) {
    return this.prisma.academicProviderCredential.upsert({
      where: { provider },
      update: {
        authMode: data.authMode,
        username: data.username,
        passwordEncrypted:
          data.password === undefined ? undefined : encryptSecret(data.password),
        accessToken: data.accessToken,
        tokenType: data.tokenType,
        accessTokenExpiresAt: data.accessTokenExpiresAt,
        sessionCookieEncrypted:
          data.sessionCookie === undefined ? undefined : encryptSecret(data.sessionCookie),
        configJson: data.config === undefined ? undefined : JSON.stringify(data.config ?? {}),
        lastLoginAt: data.lastLoginAt,
        lastLoginError: data.lastLoginError,
      },
      create: {
        provider,
        authMode: data.authMode ?? null,
        username: data.username ?? null,
        passwordEncrypted:
          data.password === undefined ? null : encryptSecret(data.password),
        accessToken: data.accessToken ?? null,
        tokenType: data.tokenType ?? null,
        accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
        sessionCookieEncrypted:
          data.sessionCookie === undefined ? null : encryptSecret(data.sessionCookie),
        configJson: JSON.stringify(data.config ?? {}),
        lastLoginAt: data.lastLoginAt ?? null,
        lastLoginError: data.lastLoginError ?? null,
      },
    });
  }

  getPassword(record: { passwordEncrypted: string | null }) {
    return decryptSecret(record.passwordEncrypted);
  }

  getSessionCookie(record: { sessionCookieEncrypted: string | null }) {
    return decryptSecret(record.sessionCookieEncrypted);
  }

  getConfig(record: { configJson: string | null }) {
    if (!record.configJson) {
      return {};
    }

    try {
      return JSON.parse(record.configJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async patchConfig(provider: AcademicProviderId, patch: Record<string, unknown>) {
    const existing = await this.get(provider);
    const currentConfig = existing ? this.getConfig(existing) : {};
    const merged = { ...currentConfig, ...patch };
    await this.prisma.academicProviderCredential.upsert({
      where: { provider },
      update: { configJson: JSON.stringify(merged) },
      create: {
        provider,
        authMode: null,
        username: null,
        passwordEncrypted: null,
        accessToken: null,
        tokenType: null,
        accessTokenExpiresAt: null,
        sessionCookieEncrypted: null,
        configJson: JSON.stringify(merged),
        lastLoginAt: null,
        lastLoginError: null,
      },
    });
  }
}

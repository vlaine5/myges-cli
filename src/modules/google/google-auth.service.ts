import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import type { Credentials, OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { AppError } from '../../lib/app-error';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import type { AcademicProviderId } from '../events/types';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SUPPORTED_PROVIDERS: AcademicProviderId[] = ['myges', 'myefrei', 'ensup'];

export class GoogleAuthService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOAuthCredentials() {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { id: 1 },
      select: { clientIdEncrypted: true, clientSecretEncrypted: true, oauthRedirectUrl: true },
    });

    const clientId =
      (connection?.clientIdEncrypted ? decryptSecret(connection.clientIdEncrypted) : null) ??
      env.googleClientId;
    const clientSecret =
      (connection?.clientSecretEncrypted ? decryptSecret(connection.clientSecretEncrypted) : null) ??
      env.googleClientSecret;
    const redirectUrl =
      connection?.oauthRedirectUrl ??
      env.googleOAuthRedirectUrl;

    return { clientId, clientSecret, redirectUrl };
  }

  async isConfigured() {
    const creds = await this.getOAuthCredentials();
    return Boolean(creds.clientId && creds.clientSecret && creds.redirectUrl);
  }

  private async assertConfigured() {
    if (!(await this.isConfigured())) {
      throw new AppError(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URL, or configure them dans l\'interface Google.',
        409,
        'GOOGLE_NOT_CONFIGURED',
      );
    }
  }

  private async createOAuthClient() {
    await this.assertConfigured();
    const { clientId, clientSecret, redirectUrl } = await this.getOAuthCredentials();

    return new google.auth.OAuth2(clientId!, clientSecret!, redirectUrl);
  }

  async saveOAuthConfig(clientId: string, clientSecret: string, redirectUrl: string) {
    await this.prisma.googleConnection.upsert({
      where: { id: 1 },
      update: {
        clientIdEncrypted: encryptSecret(clientId),
        clientSecretEncrypted: encryptSecret(clientSecret),
        oauthRedirectUrl: redirectUrl,
      },
      create: {
        id: 1,
        clientIdEncrypted: encryptSecret(clientId),
        clientSecretEncrypted: encryptSecret(clientSecret),
        oauthRedirectUrl: redirectUrl,
      },
    });
  }

  async getOAuthConfigStatus() {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { id: 1 },
      select: { clientIdEncrypted: true, clientSecretEncrypted: true, oauthRedirectUrl: true },
    });

    const hasDbClientId = Boolean(connection?.clientIdEncrypted);
    const hasDbClientSecret = Boolean(connection?.clientSecretEncrypted);

    return {
      source: hasDbClientId && hasDbClientSecret ? 'database' : 'environment',
      hasClientId: hasDbClientId || Boolean(env.googleClientId),
      hasClientSecret: hasDbClientSecret || Boolean(env.googleClientSecret),
      redirectUrl: connection?.oauthRedirectUrl ?? env.googleOAuthRedirectUrl,
      // Masked partial display only
      clientIdHint: hasDbClientId
        ? '(configuré en DB)'
        : env.googleClientId
          ? `${env.googleClientId.slice(0, 8)}...`
          : null,
    };
  }

  private async saveCredentials(tokens: Credentials) {
    await this.prisma.googleConnection.upsert({
      where: { id: 1 },
      update: {
        accessTokenEncrypted: encryptSecret(tokens.access_token ?? null),
        refreshTokenEncrypted: tokens.refresh_token
          ? encryptSecret(tokens.refresh_token)
          : undefined,
        tokenType: tokens.token_type ?? null,
        scope: tokens.scope ?? null,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      create: {
        id: 1,
        accessTokenEncrypted: encryptSecret(tokens.access_token ?? null),
        refreshTokenEncrypted: encryptSecret(tokens.refresh_token ?? null),
        tokenType: tokens.token_type ?? null,
        scope: tokens.scope ?? null,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });
  }

  async createAuthorizationUrl() {
    await this.assertConfigured();

    const state = randomUUID();
    await this.prisma.oAuthState.create({
      data: {
        state,
        provider: 'google',
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });

    const client = await this.createOAuthClient();
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: env.googleOAuthScopes,
      state,
    });

    return authUrl;
  }

  async handleOAuthCallback(code: string, state: string) {
    const oauthState = await this.prisma.oAuthState.findUnique({
      where: { state },
    });

    if (!oauthState || oauthState.expiresAt.getTime() < Date.now()) {
      throw new AppError('Google OAuth state is invalid or expired.', 400, 'GOOGLE_STATE_INVALID');
    }

    const client = await this.createOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token && !tokens.refresh_token) {
      throw new AppError('Google OAuth did not return usable tokens.', 502, 'GOOGLE_TOKEN_MISSING');
    }

    client.setCredentials(tokens);
    const oauth2 = google.oauth2({
      version: 'v2',
      auth: client,
    });
    const profile = await oauth2.userinfo.get().catch(() => null);

    await this.saveCredentials(tokens);
    if (profile?.data?.email) {
      await this.prisma.googleConnection.upsert({
        where: { id: 1 },
        update: {
          connectedEmail: profile.data.email,
        },
        create: {
          id: 1,
          connectedEmail: profile.data.email,
        },
      });
    }
    await this.prisma.oAuthState.delete({
      where: { state },
    });
  }

  async getAuthorizedClient(): Promise<OAuth2Client> {
    await this.assertConfigured();

    const connection = await this.prisma.googleConnection.findUnique({
      where: { id: 1 },
    });

    if (!connection?.refreshTokenEncrypted && !connection?.accessTokenEncrypted) {
      throw new AppError('Google Calendar is not connected.', 409, 'GOOGLE_NOT_CONNECTED');
    }

    const client = await this.createOAuthClient();
    client.setCredentials({
      access_token: decryptSecret(connection.accessTokenEncrypted ?? null) ?? undefined,
      refresh_token: decryptSecret(connection.refreshTokenEncrypted ?? null) ?? undefined,
      token_type: connection.tokenType ?? undefined,
      scope: connection.scope ?? undefined,
      expiry_date: connection.expiryDate?.getTime(),
    });
    client.on('tokens', async (tokens) => {
      await this.saveCredentials({
        access_token: tokens.access_token ?? client.credentials.access_token ?? undefined,
        refresh_token: tokens.refresh_token ?? client.credentials.refresh_token ?? undefined,
        expiry_date: tokens.expiry_date ?? client.credentials.expiry_date ?? undefined,
        scope: tokens.scope ?? client.credentials.scope ?? undefined,
        token_type: tokens.token_type ?? client.credentials.token_type ?? undefined,
      });
    });

    return client;
  }

  async disconnect() {
    await this.prisma.googleConnection.upsert({
      where: { id: 1 },
      update: {
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenType: null,
        scope: null,
        expiryDate: null,
        connectedEmail: null,
      },
      create: {
        id: 1,
      },
    });
  }

  private async getProviderCalendars(legacyConnection?: {
    calendarId: string | null;
    calendarSummary: string | null;
  }) {
    const rows = await this.prisma.googleProviderCalendar.findMany({
      orderBy: {
        provider: 'asc',
      },
    });

    return Object.fromEntries(
      SUPPORTED_PROVIDERS.map((provider) => {
        const row = rows.find((entry: (typeof rows)[number]) => entry.provider === provider);

        return [
          provider,
          {
            calendarId:
              row?.calendarId ??
              (provider === 'myges' ? legacyConnection?.calendarId ?? null : null),
            calendarSummary:
              row?.calendarSummary ??
              (provider === 'myges' ? legacyConnection?.calendarSummary ?? null : null),
          },
        ];
      }),
    ) as Record<
      AcademicProviderId,
      {
        calendarId: string | null;
        calendarSummary: string | null;
      }
    >;
  }

  async getStatus() {
    const [connection] = await Promise.all([
      this.prisma.googleConnection.findUnique({
        where: { id: 1 },
      }),
    ]);
    const providerCalendars = await this.getProviderCalendars({
      calendarId: connection?.calendarId ?? null,
      calendarSummary: connection?.calendarSummary ?? null,
    });

    return {
      configured: await this.isConfigured(),
      connected: Boolean(connection?.refreshTokenEncrypted || connection?.accessTokenEncrypted),
      hasRefreshToken: Boolean(connection?.refreshTokenEncrypted),
      tokenExpiresAt: connection?.expiryDate?.toISOString() ?? null,
      calendarId: connection?.calendarId ?? null,
      calendarSummary: connection?.calendarSummary ?? null,
      scope: connection?.scope ?? null,
      connectedEmail: connection?.connectedEmail ?? null,
      providerCalendars,
    };
  }

  async updateSelectedCalendar(
    provider: AcademicProviderId,
    calendarId: string | null,
    calendarSummary?: string | null,
  ) {
    await this.prisma.googleProviderCalendar.upsert({
      where: { provider },
      update: {
        calendarId,
        calendarSummary: calendarSummary ?? null,
      },
      create: {
        provider,
        calendarId,
        calendarSummary: calendarSummary ?? null,
      },
    });

    if (provider === 'myges') {
      await this.prisma.googleConnection.upsert({
        where: { id: 1 },
        update: {
          calendarId,
          calendarSummary: calendarSummary ?? null,
        },
        create: {
          id: 1,
          calendarId,
          calendarSummary: calendarSummary ?? null,
        },
      });
    }
  }

  async getSelectedCalendar(provider: AcademicProviderId) {
    const providerSelection = await this.prisma.googleProviderCalendar.findUnique({
      where: { provider },
    });

    if (providerSelection?.calendarId) {
      return providerSelection;
    }

    if (provider === 'myges') {
      const legacyConnection = await this.prisma.googleConnection.findUnique({
        where: { id: 1 },
      });

      if (legacyConnection?.calendarId) {
        return {
          provider,
          calendarId: legacyConnection.calendarId,
          calendarSummary: legacyConnection.calendarSummary,
          updatedAt: legacyConnection.updatedAt,
        };
      }
    }

    return null;
  }
}

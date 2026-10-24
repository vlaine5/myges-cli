import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { encryptSecret } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import type { AcademicProviderId } from '../events/types';

export const settingsInputSchema = z.object({
  provider: z.enum(['myges', 'myefrei', 'ensup']),
  timezone: z.string().min(1),
  syncEnabled: z.boolean(),
  syncLookbackDays: z.number().int().min(0).max(365),
  syncFutureDays: z.number().int().min(1).max(365),
  syncFrequencyMinutes: z.number().int().min(5).max(24 * 60),
  runSyncOnStartup: z.boolean(),
  googleSyncEnabled: z.boolean(),
  saveLastIcs: z.boolean(),
  storeRawPayload: z.boolean(),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

export class SettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureDefaults() {
    await this.prisma.appSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        provider: env.syncDefaults.provider,
        timezone: env.syncDefaults.timezone,
        syncEnabled: env.syncDefaults.enabled,
        syncLookbackDays: env.syncDefaults.lookbackDays,
        syncFutureDays: env.syncDefaults.futureDays,
        syncFrequencyMinutes: env.syncDefaults.frequencyMinutes,
        runSyncOnStartup: env.syncDefaults.runOnStartup,
        googleSyncEnabled: env.syncDefaults.googleSyncEnabled,
        saveLastIcs: env.syncDefaults.saveLastIcs,
        storeRawPayload: env.syncDefaults.storeRawPayload,
        logLevel: env.logLevel,
      },
    });
    const settings = await this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    logger.level = settings.logLevel;

    const myGesCredential = await this.prisma.academicProviderCredential.findUnique({
      where: { provider: 'myges' },
    });

    if (!myGesCredential && env.mygesUsername && env.mygesPassword) {
      await this.prisma.academicProviderCredential.create({
        data: {
          provider: 'myges',
          authMode: 'password',
          username: env.mygesUsername,
          passwordEncrypted: encryptSecret(env.mygesPassword),
          configJson: JSON.stringify({}),
        },
      });
    }

    const myEfreiCredential = await this.prisma.academicProviderCredential.findUnique({
      where: { provider: 'myefrei' },
    });

    if (
      !myEfreiCredential &&
      (env.myefreiSessionCookie || env.myefreiUsername || env.myefreiPassword || env.myefreiAgendaEndpoint)
    ) {
      await this.prisma.academicProviderCredential.create({
        data: {
          provider: 'myefrei',
          authMode: env.myefreiSessionCookie ? 'session_cookie' : 'password',
          username: env.myefreiUsername,
          passwordEncrypted: env.myefreiPassword
            ? encryptSecret(env.myefreiPassword)
            : null,
          sessionCookieEncrypted: env.myefreiSessionCookie
            ? encryptSecret(env.myefreiSessionCookie)
            : null,
          configJson: JSON.stringify({
            agendaEndpoint: env.myefreiAgendaEndpoint,
          }),
        },
      });
    }

    const ensupCredential = await this.prisma.academicProviderCredential.findUnique({
      where: { provider: 'ensup' },
    });

    if (
      !ensupCredential &&
      (
        env.ensupSessionCookie ||
        env.ensupUsername ||
        env.ensupPassword ||
        env.ensupAgendaEndpoint ||
        env.ensupIcsUrl
      )
    ) {
      await this.prisma.academicProviderCredential.create({
        data: {
          provider: 'ensup',
          authMode: env.ensupSessionCookie ? 'session_cookie' : 'password',
          username: env.ensupUsername,
          passwordEncrypted: env.ensupPassword
            ? encryptSecret(env.ensupPassword)
            : null,
          sessionCookieEncrypted: env.ensupSessionCookie
            ? encryptSecret(env.ensupSessionCookie)
            : null,
          configJson: JSON.stringify({
            agendaEndpoint: env.ensupAgendaEndpoint,
            icsUrl: env.ensupIcsUrl,
          }),
        },
      });
    }

    const googleConnection = await this.prisma.googleConnection.findUnique({
      where: { id: 1 },
    });

    if (!googleConnection) {
      await this.prisma.googleConnection.create({
        data: {
          id: 1,
          calendarId: env.googleDefaultCalendarId,
        },
      });
    } else if (!googleConnection.calendarId && env.googleDefaultCalendarId) {
      await this.prisma.googleConnection.update({
        where: { id: 1 },
        data: {
          calendarId: env.googleDefaultCalendarId,
        },
      });
    }
  }

  async getSettings() {
    return this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
  }

  async getActiveProviderId() {
    const settings = await this.getSettings();

    return settings.provider as AcademicProviderId;
  }

  async updateSettings(input: SettingsInput) {
    const settings = await this.prisma.appSettings.update({
      where: { id: 1 },
      data: input,
    });

    logger.level = settings.logLevel;

    return settings;
  }
}

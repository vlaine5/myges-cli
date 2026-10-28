import type { NotificationSettings, PrismaClient } from '@prisma/client';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { AppError } from '../../lib/app-error';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import type { AcademicProviderId } from '../events/types';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import { buildPlanningMessage, buildWebhookPayload, summarizeDiff, type WebhookFormat } from './notification-message';
import { countChanges, diffPlanning, type PlanningDiff, type PlanningEvent } from './planning-diff';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 10_000;
const LOG_LIMIT = 30;

export const SMTP_SECURITY_MODES = ['starttls', 'tls', 'none'] as const;
export const WEBHOOK_FORMATS = ['json', 'discord', 'slack'] as const;
export type NotificationChannel = 'email' | 'webhook';

const emailListSchema = z
  .string()
  .trim()
  .max(1000)
  .refine(
    (value) => value === '' || splitRecipients(value).every((address) => z.string().email().safeParse(address).success),
    'Adresse e-mail invalide.',
  );

const optionalText = z.string().trim().max(255);

export const notificationSettingsInputSchema = z.object({
  emailEnabled: z.boolean(),
  smtpHost: optionalText,
  smtpPort: z.number({ message: 'Port invalide.' }).int('Port invalide.').min(1, 'Port invalide.').max(65535, 'Port invalide.'),
  smtpSecurity: z.enum(SMTP_SECURITY_MODES),
  smtpUser: optionalText,
  /** Omitted or empty: keep the stored password. null: remove it. */
  smtpPassword: z.string().max(1000).nullable().optional(),
  emailFrom: optionalText,
  emailTo: emailListSchema,
  webhookEnabled: z.boolean(),
  /** Omitted or empty: keep the stored URL. null: remove it. */
  webhookUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => value === '' || /^https?:\/\//i.test(value), 'L’URL doit commencer par http:// ou https://.')
    .nullable()
    .optional(),
  webhookFormat: z.enum(WEBHOOK_FORMATS),
  notifyAdded: z.boolean(),
  notifyUpdated: z.boolean(),
  notifyRemoved: z.boolean(),
  horizonDays: z
    .number({ message: 'Nombre de jours invalide.' })
    .int('Nombre de jours invalide.')
    .min(1, 'Au moins 1 jour.')
    .max(365, 'Au plus 365 jours.'),
});

export type NotificationSettingsInput = z.infer<typeof notificationSettingsInputSchema>;

export const notificationTestInputSchema = z.object({ channel: z.enum(['email', 'webhook']) });

export interface NotificationSettingsDto {
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: (typeof SMTP_SECURITY_MODES)[number];
  smtpUser: string;
  smtpPasswordSet: boolean;
  emailFrom: string;
  emailTo: string;
  webhookEnabled: boolean;
  webhookUrlSet: boolean;
  /** Scheme and host only: the path usually embeds the webhook's token. */
  webhookUrlHint: string | null;
  webhookFormat: WebhookFormat;
  notifyAdded: boolean;
  notifyUpdated: boolean;
  notifyRemoved: boolean;
  horizonDays: number;
}

/** The planning of one provider just before a refresh, to diff against afterwards. */
export interface PlanningCapture {
  provider: AcademicProviderId;
  capturedAt: Date;
  /** False when there was no upcoming event to compare with: everything would look new. */
  hadEvents: boolean;
  events: PlanningEvent[];
}

interface NotificationDependencies {
  createTransport: typeof createTransport;
  fetch: typeof fetch;
  /** Waits before each new attempt of a failed delivery. */
  retryDelaysMs: number[];
}

function splitRecipients(value: string) {
  return value
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean);
}

function urlHint(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tells the user when a provider's timetable changes: courses added, moved or
 * otherwise modified, and cancelled. A refresh that leaves the planning as it
 * was sends nothing.
 */
export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistryService: ProviderRegistryService,
    private readonly dependencies: NotificationDependencies = {
      createTransport,
      fetch: globalThis.fetch,
      retryDelaysMs: [5_000, 30_000],
    },
  ) {}

  private readonly providerLocks = new Map<AcademicProviderId, Promise<void>>();

  private async getRow(): Promise<NotificationSettings> {
    return this.prisma.notificationSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  private toDto(row: NotificationSettings): NotificationSettingsDto {
    let webhookUrl: string | null = null;
    try {
      webhookUrl = decryptSecret(row.webhookUrlEncrypted);
    } catch {
      webhookUrl = null;
    }

    return {
      emailEnabled: row.emailEnabled,
      smtpHost: row.smtpHost ?? '',
      smtpPort: row.smtpPort,
      smtpSecurity: (SMTP_SECURITY_MODES as readonly string[]).includes(row.smtpSecurity)
        ? (row.smtpSecurity as NotificationSettingsDto['smtpSecurity'])
        : 'starttls',
      smtpUser: row.smtpUser ?? '',
      smtpPasswordSet: Boolean(row.smtpPasswordEncrypted),
      emailFrom: row.emailFrom ?? '',
      emailTo: row.emailTo ?? '',
      webhookEnabled: row.webhookEnabled,
      webhookUrlSet: Boolean(row.webhookUrlEncrypted),
      webhookUrlHint: urlHint(webhookUrl),
      webhookFormat: (WEBHOOK_FORMATS as readonly string[]).includes(row.webhookFormat)
        ? (row.webhookFormat as WebhookFormat)
        : 'json',
      notifyAdded: row.notifyAdded,
      notifyUpdated: row.notifyUpdated,
      notifyRemoved: row.notifyRemoved,
      horizonDays: row.horizonDays,
    };
  }

  async getSettings() {
    return this.toDto(await this.getRow());
  }

  async updateSettings(input: NotificationSettingsInput) {
    const current = await this.getRow();

    // A stored password only ever goes to the server and login it was typed
    // for: the API never returns it, and must not let it be redirected elsewhere.
    const smtpTargetChanged =
      (input.smtpHost || null) !== current.smtpHost ||
      input.smtpPort !== current.smtpPort ||
      input.smtpSecurity !== current.smtpSecurity ||
      (input.smtpUser || null) !== current.smtpUser;
    let smtpPasswordEncrypted =
      input.smtpPassword === null
        ? null
        : input.smtpPassword
          ? encryptSecret(input.smtpPassword)
          : current.smtpPasswordEncrypted;
    if (!input.smtpUser) {
      smtpPasswordEncrypted = null;
    } else if (!input.smtpPassword && smtpTargetChanged && current.smtpPasswordEncrypted) {
      throw new AppError(
        'Le serveur SMTP ou l’identifiant a changé : ressaisis le mot de passe.',
        400,
        'NOTIFICATION_SMTP_PASSWORD_REQUIRED',
      );
    }
    const webhookUrlEncrypted =
      input.webhookUrl === null
        ? null
        : input.webhookUrl
          ? encryptSecret(input.webhookUrl)
          : current.webhookUrlEncrypted;

    if (input.emailEnabled && (!input.smtpHost || !input.emailFrom || !input.emailTo)) {
      throw new AppError(
        'Renseigne le serveur SMTP, l’expéditeur et au moins un destinataire pour activer les e-mails.',
        400,
        'NOTIFICATION_EMAIL_INCOMPLETE',
      );
    }
    if (input.webhookEnabled && !webhookUrlEncrypted) {
      throw new AppError('Renseigne l’URL du webhook pour l’activer.', 400, 'NOTIFICATION_WEBHOOK_INCOMPLETE');
    }

    const row = await this.prisma.notificationSettings.update({
      where: { id: 1 },
      data: {
        emailEnabled: input.emailEnabled,
        smtpHost: input.smtpHost || null,
        smtpPort: input.smtpPort,
        smtpSecurity: input.smtpSecurity,
        smtpUser: input.smtpUser || null,
        smtpPasswordEncrypted,
        emailFrom: input.emailFrom || null,
        emailTo: splitRecipients(input.emailTo).join(', ') || null,
        webhookEnabled: input.webhookEnabled,
        webhookUrlEncrypted,
        webhookFormat: input.webhookFormat,
        notifyAdded: input.notifyAdded,
        notifyUpdated: input.notifyUpdated,
        notifyRemoved: input.notifyRemoved,
        horizonDays: input.horizonDays,
      },
    });
    return this.toDto(row);
  }

  async listLog() {
    return this.prisma.notificationLog.findMany({ orderBy: { createdAt: 'desc' }, take: LOG_LIMIT });
  }

  private async loadPlanning(provider: AcademicProviderId, now: Date): Promise<PlanningEvent[]> {
    return this.prisma.eventSnapshot.findMany({
      where: { provider, endAt: { gt: now } },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        room: true,
        campus: true,
        teacher: true,
        modality: true,
      },
    });
  }

  /**
   * Runs `refresh` (which rewrites `provider`'s events) and notifies the
   * planning changes it made, even when it fails part-way: what it already
   * committed would otherwise never be reported. Refreshes of one provider are
   * serialised here, as the agenda ICS path does not take the sync lock, so two
   * overlapping runs cannot both report the same change.
   */
  async trackPlanningChanges<T>(provider: AcademicProviderId, refresh: () => Promise<T>): Promise<T> {
    const previous = this.providerLocks.get(provider) ?? Promise.resolve();
    let release = () => {};
    const current = previous.then(() => new Promise<void>((resolve) => (release = resolve)));
    this.providerLocks.set(provider, current);
    await previous;

    try {
      const capture = await this.capturePlanning(provider);
      try {
        return await refresh();
      } finally {
        await this.notifyPlanningChanges(capture);
      }
    } finally {
      release();
      if (this.providerLocks.get(provider) === current) this.providerLocks.delete(provider);
    }
  }

  private async capturePlanning(provider: AcademicProviderId): Promise<PlanningCapture | null> {
    try {
      const capturedAt = new Date();
      const events = await this.loadPlanning(provider, capturedAt);
      // An empty planning is the provider's first fetch, or one whose future
      // events were just deleted by hand: everything would look new.
      return { provider, capturedAt, hadEvents: events.length > 0, events };
    } catch (error) {
      logger.warn({ err: error, provider }, 'Could not capture the planning before a refresh.');
      return null;
    }
  }

  /**
   * Diffs the provider's planning against `capture` and sends the changes on
   * every enabled channel. Never throws: a notification problem must not fail
   * the sync that triggered it.
   */
  private async notifyPlanningChanges(capture: PlanningCapture | null) {
    if (!capture?.hadEvents) return;

    try {
      const row = await this.getRow();
      if (!row.emailEnabled && !row.webhookEnabled) return;

      const now = capture.capturedAt;
      const fullDiff = diffPlanning(capture.events, await this.loadPlanning(capture.provider, now), {
        now,
        horizonEnd: new Date(now.getTime() + row.horizonDays * DAY_MS),
      });
      const diff: PlanningDiff = {
        added: row.notifyAdded ? fullDiff.added : [],
        updated: row.notifyUpdated ? fullDiff.updated : [],
        removed: row.notifyRemoved ? fullDiff.removed : [],
      };
      if (countChanges(diff) === 0) return;

      await this.dispatch(row, capture.provider, diff, false);
    } catch (error) {
      logger.error({ err: error, provider: capture.provider }, 'Planning change notification failed.');
    }
  }

  /** Sends a sample notification on one channel with the saved settings. */
  async sendTest(channel: NotificationChannel) {
    const row = await this.getRow();
    const start = new Date(Date.now() + DAY_MS);
    start.setUTCMinutes(0, 0, 0);
    const sample: PlanningEvent = {
      id: 'test',
      title: 'Cours d’exemple',
      startAt: start,
      endAt: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      room: 'Salle 101',
      campus: null,
      teacher: null,
      modality: null,
    };
    const diff: PlanningDiff = {
      added: [sample],
      updated: [
        {
          before: sample,
          after: { ...sample, room: 'Salle 204' },
          changedFields: ['room'],
        },
      ],
      removed: [],
    };

    const [result] = await this.dispatch(row, null, diff, true, [channel]);
    if (result?.status === 'FAILED') {
      throw new AppError(`Échec de l’envoi : ${result.error}`, 502, 'NOTIFICATION_TEST_FAILED');
    }
  }

  private async dispatch(
    row: NotificationSettings,
    provider: AcademicProviderId | null,
    diff: PlanningDiff,
    test: boolean,
    channels: NotificationChannel[] = [
      ...(row.emailEnabled ? (['email'] as const) : []),
      ...(row.webhookEnabled ? (['webhook'] as const) : []),
    ],
  ) {
    const [settings, providerLabel] = await Promise.all([
      this.prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } }),
      Promise.resolve(provider ? this.providerRegistryService.getProvider(provider).displayName : 'Test'),
    ]);
    const message = buildPlanningMessage(providerLabel, diff, settings.timezone);
    const summary = summarizeDiff(diff);
    const results: Array<{ channel: NotificationChannel; status: 'SENT' | 'FAILED'; error: string | null }> = [];

    // A test reports straight back to the user; a real change is retried, as
    // the next sync will not detect it again.
    const retryDelays = test ? [] : this.dependencies.retryDelaysMs;

    for (const channel of channels) {
      let error: string | null = null;
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt - 1]));
        try {
          if (channel === 'email') {
            await this.sendEmail(row, message);
          } else {
            const format = this.toDto(row).webhookFormat;
            await this.sendWebhook(row, buildWebhookPayload(format, { provider, providerLabel, test }, diff, message));
          }
          error = null;
          break;
        } catch (sendError) {
          error = errorMessage(sendError);
          logger.warn({ provider, channel, attempt: attempt + 1, error }, 'Notification delivery failed.');
        }
      }

      const status = error ? 'FAILED' : 'SENT';
      results.push({ channel, status, error });
      await this.prisma.notificationLog.create({
        data: {
          provider,
          channel,
          status,
          test,
          changeCount: countChanges(diff),
          summary,
          // Kept so a change whose delivery failed can still be read in the app
          message: message.text,
          error,
        },
      });
    }

    if (!test) {
      logger.info({ provider, summary, channels }, 'Planning change notification processed.');
    }
    return results;
  }

  private async sendEmail(row: NotificationSettings, message: { subject: string; text: string; html: string }) {
    const recipients = splitRecipients(row.emailTo ?? '');
    if (!row.smtpHost || !row.emailFrom || recipients.length === 0) {
      throw new Error('Configuration e-mail incomplète (serveur, expéditeur ou destinataire manquant).');
    }

    const password = row.smtpUser ? decryptSecret(row.smtpPasswordEncrypted) : null;
    if (row.smtpUser && !password) {
      throw new Error(`Aucun mot de passe SMTP enregistré pour l’identifiant ${row.smtpUser}.`);
    }
    const transport = this.dependencies.createTransport({
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpSecurity === 'tls',
      requireTLS: row.smtpSecurity === 'starttls',
      ignoreTLS: row.smtpSecurity === 'none',
      auth: row.smtpUser ? { user: row.smtpUser, pass: password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    try {
      await transport.sendMail({
        from: row.emailFrom,
        to: recipients.join(', '),
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } finally {
      transport.close();
    }
  }

  private async sendWebhook(row: NotificationSettings, payload: unknown) {
    const url = decryptSecret(row.webhookUrlEncrypted);
    if (!url) {
      throw new Error('Aucune URL de webhook enregistrée.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.dependencies.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'myges-cli-notifier' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Le webhook n’a pas répondu en ${WEBHOOK_TIMEOUT_MS / 1000} s.`);
      }
      // Report the network cause only: never the URL, whose path holds the token.
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      throw new Error(cause ? `Webhook injoignable (${cause}).` : 'Webhook injoignable.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // The response body is not echoed: some services reflect the request URL, token included.
      throw new Error(`Le webhook a répondu ${response.status} ${response.statusText}`.trim());
    }
  }
}

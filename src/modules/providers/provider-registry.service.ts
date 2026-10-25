import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import type { AcademicProviderId } from '../events/types';
import type { AcademicProvider } from './types';

export class ProviderRegistryService {
  private readonly providers = new Map<AcademicProviderId, AcademicProvider>();

  constructor(
    private readonly prisma: PrismaClient,
    providers: AcademicProvider[],
  ) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  getProviders(): AcademicProvider[] {
    return [...this.providers.values()];
  }

  getProvider(providerId: AcademicProviderId) {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new AppError(`Unknown academic provider: ${providerId}.`, 404, 'PROVIDER_NOT_FOUND');
    }

    return provider;
  }

  async getActiveProviderId() {
    const settings = await this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { provider: true },
    });

    return settings.provider as AcademicProviderId;
  }

  async getActiveProvider() {
    return this.getProvider(await this.getActiveProviderId());
  }

  async listStatuses() {
    const statuses = await Promise.all(
      [...this.providers.values()].map((provider) => provider.getStatus()),
    );

    return statuses;
  }
}

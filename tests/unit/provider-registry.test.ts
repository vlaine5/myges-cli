import { describe, expect, it } from 'vitest';
import { ProviderRegistryService } from '../../src/modules/providers/provider-registry.service';
import type { AcademicProvider } from '../../src/modules/providers/types';

function buildProvider(id: 'myges' | 'myefrei'): AcademicProvider {
  return {
    id,
    displayName: id === 'myges' ? 'MyGES' : 'myEfrei',
    authenticate: async () => ({
      provider: id,
      displayName: id,
      configured: true,
      authMode: 'password',
      username: 'user',
      hasToken: false,
      hasSessionCookie: false,
      tokenExpiresAt: null,
      lastLoginAt: null,
      lastLoginError: null,
      config: {},
      limitations: [],
    }),
    testConnection: async () => ({ ok: true }),
    getStatus: async () => ({
      provider: id,
      displayName: id,
      configured: true,
      authMode: 'password',
      username: 'user',
      hasToken: false,
      hasSessionCookie: false,
      tokenExpiresAt: null,
      lastLoginAt: null,
      lastLoginError: null,
      config: {},
      limitations: [],
    }),
    fetchEvents: async () => [],
  };
}

describe('ProviderRegistryService', () => {
  it('returns the active provider resolved from settings', async () => {
    const prisma = {
      appSettings: {
        findUniqueOrThrow: async () => ({ provider: 'myefrei' }),
      },
    } as never;

    const registry = new ProviderRegistryService(prisma, [
      buildProvider('myges'),
      buildProvider('myefrei'),
    ]);

    const provider = await registry.getActiveProvider();

    expect(provider.id).toBe('myefrei');
  });

  it('lists the statuses of every registered provider', async () => {
    const prisma = {
      appSettings: {
        findUniqueOrThrow: async () => ({ provider: 'myges' }),
      },
    } as never;

    const registry = new ProviderRegistryService(prisma, [
      buildProvider('myges'),
      buildProvider('myefrei'),
    ]);

    const statuses = await registry.listStatuses();

    expect(statuses.map((status) => status.provider)).toEqual(['myges', 'myefrei']);
  });
});

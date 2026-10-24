import type { RangeQuery } from '../events/types';
import type { AcademicProviderId, NormalizedEvent } from '../events/types';

export interface AcademicProviderCredentialInput {
  username?: string;
  password?: string;
  sessionCookie?: string;
  config?: Record<string, unknown>;
}

export interface AcademicProviderStatus {
  provider: AcademicProviderId;
  displayName: string;
  configured: boolean;
  authMode: string | null;
  hasSavedCredentials: boolean;
  hasToken: boolean;
  hasSessionCookie: boolean;
  tokenExpiresAt: string | null;
  lastLoginAt: string | null;
  lastLoginError: string | null;
  config: Record<string, unknown>;
  limitations: string[];
}

export interface AcademicProviderTestResult {
  ok: true;
  profile?: unknown;
  note?: string | null;
}

export interface AcademicProvider {
  readonly id: AcademicProviderId;
  readonly displayName: string;
  authenticate(input: AcademicProviderCredentialInput): Promise<AcademicProviderStatus>;
  testConnection(input?: AcademicProviderCredentialInput): Promise<AcademicProviderTestResult>;
  getStatus(): Promise<AcademicProviderStatus>;
  fetchEvents(
    range: RangeQuery,
    options?: { includeRawPayload?: boolean },
  ): Promise<NormalizedEvent[]>;
}

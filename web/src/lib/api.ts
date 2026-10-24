import type {
  EventMatch,
  GlobalEvent,
  GlobalEventDetail,
  RollbackJobResult,
  SyncJobEventChange,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
        details?: unknown;
      };
      throw new ApiError(
        payload.message ?? 'API request failed.',
        response.status,
        payload.error,
        payload.details,
      );
    }

    throw new ApiError(await response.text(), response.status);
  }

  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

export const api = {
  getDashboard: () => request('/dashboard'),
  getHealth: () => request('/health'),
  getDiagnostics: () => request('/diagnostics'),
  listProviders: () => request('/providers'),
  getProviderStatus: (provider: 'myges' | 'myefrei' | 'ensup') =>
    request(`/providers/${provider}/status`),
  testProvider: (
    provider: 'myges' | 'myefrei' | 'ensup',
    payload: { username?: string; password?: string; sessionCookie?: string; config?: Record<string, unknown> },
  ) =>
    request(`/providers/${provider}/test`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveProvider: (
    provider: 'myges' | 'myefrei' | 'ensup',
    payload: { username?: string; password?: string; sessionCookie?: string; config?: Record<string, unknown> },
  ) =>
    request(`/providers/${provider}/login`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getGoogleStatus: () => request('/google/status'),
  getGoogleConfig: () => request('/google/config'),
  saveGoogleConfig: (payload: { clientId: string; clientSecret: string; redirectUrl: string }) =>
    request('/google/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  syncFromIcs: (payload: { provider: 'myges' | 'myefrei' | 'ensup'; icsUrl: string }) =>
    request('/ics/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  patchProviderConfig: (
    provider: 'myges' | 'myefrei' | 'ensup',
    patch: { agendaEndpoint?: string | null; icsUrl?: string | null },
  ) =>
    request(`/providers/${provider}/config`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  startGoogleOAuth: () =>
    request<{ authUrl: string }>('/google/oauth/start', {
      method: 'POST',
    }),
  disconnectGoogle: () =>
    request('/google/disconnect', {
      method: 'POST',
    }),
  listGoogleCalendars: () => request('/google/calendars'),
  createGoogleCalendar: (payload: { provider: 'myges' | 'myefrei' | 'ensup'; summary: string; timeZone: string }) =>
    request('/google/calendars', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  selectGoogleCalendar: (payload: { provider: 'myges' | 'myefrei' | 'ensup'; calendarId: string }) =>
    request('/google/calendar', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getSettings: () => request('/settings'),
  saveSettings: (payload: unknown) =>
    request('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getEvents: (search: URLSearchParams) => request(`/events?${search.toString()}`),
  getActiveProviders: (start?: string, end?: string) => {
    const p = new URLSearchParams();
    if (start) p.set('start', start);
    if (end) p.set('end', end);
    return request<string[]>(`/events/providers?${p.toString()}`);
  },
  deleteEvents: (params: { provider?: string; agendaId?: string; scope: 'future' | 'all' }) => {
    const p = new URLSearchParams({ scope: params.scope });
    if (params.provider) p.set('provider', params.provider);
    if (params.agendaId) p.set('agendaId', params.agendaId);
    return request(`/events?${p.toString()}`, { method: 'DELETE' });
  },
  getEvent: (id: string) => request(`/events/${id}?includeRawPayload=true`),
  runSync: (payload?: { start?: string; end?: string }) =>
    request('/sync/run', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  dryRunSync: (payload?: { start?: string; end?: string }) =>
    request('/sync/dry-run', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  runSyncForProvider: (payload?: { start?: string; end?: string; provider?: 'myges' | 'myefrei' | 'ensup' }) =>
    request('/sync/run', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  dryRunSyncForProvider: (payload?: { start?: string; end?: string; provider?: 'myges' | 'myefrei' | 'ensup' }) =>
    request('/sync/dry-run', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  getSyncHistory: (provider?: 'myges' | 'myefrei' | 'ensup', limit?: number) => {
    const search = new URLSearchParams();
    if (provider) search.set('provider', provider);
    if (limit) search.set('limit', String(limit));
    const query = search.toString();
    return request(`/sync/history${query ? `?${query}` : ''}`);
  },
  // GlobalEvent read model (reconciliation tier) — the calendar-facing data source.
  getGlobalEvents: (search: URLSearchParams) => request<GlobalEvent[]>(`/global-events?${search.toString()}`),
  getGlobalEvent: (id: string) => request<GlobalEventDetail>(`/global-events/${id}`),
  // Reconciliation suggestions (pending cross-provider merge candidates).
  getReconciliationSuggestions: (provider?: string) =>
    request<EventMatch[]>(`/reconciliation/suggestions${provider ? `?provider=${provider}` : ''}`),
  confirmSuggestion: (matchId: string, decidedBy?: string) =>
    request(`/reconciliation/suggestions/${matchId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(decidedBy ? { decidedBy } : {}),
    }),
  rejectSuggestion: (matchId: string, decidedBy?: string) =>
    request(`/reconciliation/suggestions/${matchId}/reject`, {
      method: 'POST',
      body: JSON.stringify(decidedBy ? { decidedBy } : {}),
    }),
  unlinkSnapshot: (globalEventId: string, snapshotId: string, decidedBy?: string) =>
    request(`/reconciliation/links/${globalEventId}/unlink`, {
      method: 'POST',
      body: JSON.stringify({ snapshotId, ...(decidedBy ? { decidedBy } : {}) }),
    }),
  // Per-job sync change log + rollback.
  getSyncJobChanges: (jobId: string) => request<SyncJobEventChange[]>(`/sync/jobs/${jobId}/changes`),
  rollbackSyncChange: (jobId: string, changeId: string) =>
    request<SyncJobEventChange[]>(`/sync/jobs/${jobId}/changes/${changeId}/rollback`, { method: 'POST' }),
  rollbackSyncJob: (jobId: string) =>
    request<RollbackJobResult>(`/sync/jobs/${jobId}/rollback`, { method: 'POST' }),
  getLatestIcsExport: () => request('/export/ics/latest'),
  downloadIcs: (params?: { save?: boolean; provider?: 'myges' | 'myefrei' | 'ensup'; refresh?: boolean; start?: string; end?: string }) => {
    const search = new URLSearchParams();
    search.set('save', params?.save === false ? 'false' : 'true');
    if (params?.provider) search.set('provider', params.provider);
    if (params?.refresh) search.set('refresh', 'true');
    if (params?.start) search.set('start', params.start);
    if (params?.end) search.set('end', params.end);
    window.open(`/api/export/ics?${search.toString()}`, '_blank');
  },
  getTeachingStats: (params?: { start?: string; end?: string; provider?: string; subject?: string }) => {
    const search = new URLSearchParams();
    if (params?.start) search.set('start', params.start);
    if (params?.end) search.set('end', params.end);
    if (params?.provider) search.set('provider', params.provider);
    if (params?.subject) search.set('subject', params.subject);
    return request(`/stats/teaching?${search.toString()}`);
  },
  // ICS Imports
  detectIcsProvider: (content: string) =>
    request('/imports/detect', { method: 'POST', body: JSON.stringify({ content }) }),
  previewIcsFile: (payload: { content: string; fallbackProvider?: string }) =>
    request('/imports/ics/preview/file', { method: 'POST', body: JSON.stringify(payload) }),
  previewIcsUrl: (payload: { icsUrl: string; fallbackProvider?: string }) =>
    request('/imports/ics/preview/url', { method: 'POST', body: JSON.stringify(payload) }),
  importIcsFile: (payload: { content: string; provider: string; name?: string; filename?: string }) =>
    request('/imports/ics/file', { method: 'POST', body: JSON.stringify(payload) }),
  importIcsUrl: (payload: { icsUrl: string; provider: string; name?: string }) =>
    request('/imports/ics/url', { method: 'POST', body: JSON.stringify(payload) }),
  listImports: () => request('/imports'),
  getImport: (id: string) => request(`/imports/${id}`),
  getImportEvents: (id: string) => request(`/imports/${id}/events`),
  deleteImport: (id: string, deleteEvents: 'none' | 'future' | 'all' = 'none') =>
    request(`/imports/${id}?deleteEvents=${deleteEvents}`, { method: 'DELETE' }),
  reimportIcs: (id: string) =>
    request(`/imports/${id}/reimport`, { method: 'POST' }),
  // Enrichment Rules
  listEnrichmentRules: () => request('/enrichment-rules'),
  getEnrichmentRule: (id: string) => request(`/enrichment-rules/${id}`),
  createEnrichmentRule: (payload: unknown) =>
    request('/enrichment-rules', { method: 'POST', body: JSON.stringify(payload) }),
  updateEnrichmentRule: (id: string, payload: unknown) =>
    request(`/enrichment-rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteEnrichmentRule: (id: string) =>
    request(`/enrichment-rules/${id}`, { method: 'DELETE' }),
  // Agendas
  listAgendas: () => request('/agendas'),
  getAgenda: (id: string) => request(`/agendas/${id}`),
  createAgenda: (payload: unknown) =>
    request('/agendas', { method: 'POST', body: JSON.stringify(payload) }),
  updateAgenda: (id: string, payload: unknown) =>
    request(`/agendas/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAgenda: (id: string) =>
    request(`/agendas/${id}`, { method: 'DELETE' }),
  syncAgenda: (id: string, dryRun = false) =>
    request(`/agendas/${id}/sync`, { method: 'POST', body: JSON.stringify({ dryRun }) }),
  testAgenda: (id: string) =>
    request(`/agendas/${id}/test`, { method: 'POST' }),
};

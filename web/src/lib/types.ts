// Shared shapes for the GlobalEvent / reconciliation / sync-rollback read models.
// Kept in one place because they're used across HomePage, EventDetailPanel,
// ActivityPanel, MatchesPage and SyncJobDetailPage — duplicating them per-file
// (as the older pages do for their own simpler, page-local shapes) would drift.

export type ProviderId = 'myges' | 'myefrei' | 'ensup' | 'generic';

export interface EventSnapshot {
  id: string;
  provider: ProviderId;
  title: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  teacher: string | null;
  room: string | null;
  campus: string | null;
  promotion: string | null;
  groupName: string | null;
  modality: string | null;
  studentCount: number | null;
  globalEventId: string;
}

export interface EventMapping {
  id: string;
  provider: string;
  globalEventId: string;
  googleEventId: string | null;
  lastAction: string | null;
  lastSyncedAt: string | null;
  deletedAt: string | null;
}

export interface GlobalEvent {
  id: string;
  title: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  teacher: string | null;
  room: string | null;
  campus: string | null;
  promotion: string | null;
  groupName: string | null;
  modality: string | null;
  primarySnapshotId: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  snapshots: EventSnapshot[];
  mapping: EventMapping | null;
}

export type MatchStatus = 'SUGGESTED' | 'AMBIGUOUS' | 'AUTO_LINKED' | 'CONFIRMED' | 'REJECTED' | 'UNLINKED';
export type MatchBasis = 'VERIFIED_IDENTIFIER' | 'APPROVED_PRIOR_MATCH' | 'FUZZY_RESEMBLANCE';

export interface EventMatch {
  id: string;
  globalEventId: string;
  snapshotId: string;
  status: MatchStatus;
  matchBasis: MatchBasis;
  confidence: number | null;
  reasonJson: string | null;
  decidedBy: string | null;
  decidedAt: string;
  snapshot: EventSnapshot;
  globalEvent: GlobalEvent;
}

export interface GlobalEventDetail extends GlobalEvent {
  matches: EventMatch[];
}

export type SyncJobChangeAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'ROLLED_BACK';

export interface SyncJobEventChange {
  id: string;
  syncJobId: string;
  globalEventId: string | null;
  snapshotId: string | null;
  action: SyncJobChangeAction;
  googleEventId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

export interface SyncJob {
  id: string;
  provider: string;
  trigger: string;
  dryRun: boolean;
  status: string;
  rangeStart: string;
  rangeEnd: string;
  eventsFetched: number;
  eventsDeduped: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
  exportedCount: number;
  errorMessage: string | null;
  summary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RollbackJobResult {
  results: Array<{ changeId: string; status: 'ROLLED_BACK' | 'FAILED'; error?: string }>;
}

export type SchedulableProvider = 'myges' | 'myefrei' | 'ensup';

export interface ProviderSchedule {
  provider: SchedulableProvider;
  enabled: boolean;
  /** 0=Sun .. 6=Sat */
  days: number[];
  /** "HH:MM" in the app timezone */
  times: string[];
  pushToGoogle: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastJobId: string | null;
}

-- Reconciliation data model: a GlobalEvent tier between per-provider EventSnapshot
-- rows and the Google Calendar EventMapping, plus an EventMatch audit trail and a
-- SyncJobEventChange per-sync-job change log.
--
-- Ordering is deliberate. SQLite enforces foreign keys immediately even inside a
-- single migration transaction (PRAGMA foreign_keys cannot be toggled off
-- mid-transaction, and this migration runner always wraps a whole file in one),
-- so any table that needs to be rebuilt (EventMapping, then EventSnapshot) is
-- rebuilt BEFORE a new table gains a live FK pointing at it.

-- 1. GlobalEvent. primarySnapshotId is intentionally a plain unique column with no
--    FK (no Prisma relation is declared for it either) so it can be populated
--    before EventSnapshot reaches its final shape.
CREATE TABLE "GlobalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "teacher" TEXT,
    "room" TEXT,
    "campus" TEXT,
    "promotion" TEXT,
    "groupName" TEXT,
    "modality" TEXT,
    "primarySnapshotId" TEXT,
    "retiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "GlobalEvent_primarySnapshotId_key" ON "GlobalEvent"("primarySnapshotId");
CREATE INDEX "GlobalEvent_startAt_idx" ON "GlobalEvent"("startAt");
CREATE INDEX "GlobalEvent_retiredAt_idx" ON "GlobalEvent"("retiredAt");

-- 2. Backfill: one solo GlobalEvent per existing EventSnapshot (1:1 by default).
INSERT INTO "GlobalEvent" (
    "id", "title", "subject", "startAt", "endAt", "teacher", "room", "campus",
    "promotion", "groupName", "modality", "primarySnapshotId", "retiredAt",
    "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "title", "subject", "startAt", "endAt", "teacher", "room", "campus",
    "promotion", "groupName", "modality", "id", NULL,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "EventSnapshot";

-- 3. Stage EventSnapshot.globalEventId as a temporary nullable column; it is
--    folded into the rebuilt table in step 6.
ALTER TABLE "EventSnapshot" ADD COLUMN "globalEventId" TEXT;
UPDATE "EventSnapshot"
SET "globalEventId" = (
    SELECT "id" FROM "GlobalEvent" WHERE "GlobalEvent"."primarySnapshotId" = "EventSnapshot"."id"
);

-- 4. Stage EventMapping.globalEventId, resolved via the OLD sourceEventId while
--    EventSnapshot still carries it.
ALTER TABLE "EventMapping" ADD COLUMN "globalEventId" TEXT;
UPDATE "EventMapping"
SET "globalEventId" = (
    SELECT "globalEventId" FROM "EventSnapshot" WHERE "EventSnapshot"."id" = "EventMapping"."sourceEventId"
);

-- 5. Rebuild EventMapping to its final shape: drop sourceEventId (and its FK to
--    EventSnapshot), globalEventId becomes the unique key with a FK to
--    GlobalEvent. This MUST happen before EventSnapshot is rebuilt below, since
--    EventMapping is the only thing with a live FK into EventSnapshot today.
CREATE TABLE "EventMapping_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "globalEventId" TEXT NOT NULL,
    "googleEventId" TEXT,
    "lastSyncedHash" TEXT,
    "lastKnownStartAt" DATETIME NOT NULL,
    "lastKnownEndAt" DATETIME NOT NULL,
    "lastAction" TEXT,
    "lastSyncedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventMapping_globalEventId_fkey" FOREIGN KEY ("globalEventId") REFERENCES "GlobalEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "EventMapping_new" (
    "id", "provider", "globalEventId", "googleEventId", "lastSyncedHash",
    "lastKnownStartAt", "lastKnownEndAt", "lastAction", "lastSyncedAt", "deletedAt",
    "createdAt", "updatedAt"
)
SELECT
    "id", "provider", "globalEventId", "googleEventId", "lastSyncedHash",
    "lastKnownStartAt", "lastKnownEndAt", "lastAction", "lastSyncedAt", "deletedAt",
    "createdAt", "updatedAt"
FROM "EventMapping";
DROP TABLE "EventMapping";
ALTER TABLE "EventMapping_new" RENAME TO "EventMapping";
CREATE UNIQUE INDEX "EventMapping_globalEventId_key" ON "EventMapping"("globalEventId");
CREATE INDEX "EventMapping_lastKnownStartAt_idx" ON "EventMapping"("lastKnownStartAt");
CREATE INDEX "EventMapping_provider_lastKnownStartAt_idx" ON "EventMapping"("provider", "lastKnownStartAt");

-- 6. Rebuild EventSnapshot to its final shape: globalEventId becomes NOT NULL
--    with a FK to GlobalEvent. Safe now: EventMapping no longer references
--    EventSnapshot (rebuilt above), and EventMatch (the only other table that
--    will reference EventSnapshot) is created AFTER this rebuild, below.
CREATE TABLE "EventSnapshot_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "agendaId" TEXT,
    "sourceId" TEXT NOT NULL,
    "reservationId" INTEGER,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "teacher" TEXT,
    "room" TEXT,
    "campus" TEXT,
    "roomsJson" TEXT,
    "promotion" TEXT,
    "groupName" TEXT,
    "classesJson" TEXT,
    "modality" TEXT,
    "reservationType" TEXT,
    "studentCount" INTEGER,
    "disciplineName" TEXT,
    "disciplineTeacher" TEXT,
    "disciplineId" INTEGER,
    "sourceHash" TEXT NOT NULL,
    "rawPayload" TEXT,
    "lastSeenAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "globalEventId" TEXT NOT NULL,
    CONSTRAINT "EventSnapshot_globalEventId_fkey" FOREIGN KEY ("globalEventId") REFERENCES "GlobalEvent" ("id")
);
INSERT INTO "EventSnapshot_new" (
    "id", "provider", "agendaId", "sourceId", "reservationId", "title", "subject",
    "startAt", "endAt", "teacher", "room", "campus", "roomsJson", "promotion",
    "groupName", "classesJson", "modality", "reservationType", "studentCount",
    "disciplineName", "disciplineTeacher", "disciplineId", "sourceHash",
    "rawPayload", "lastSeenAt", "createdAt", "updatedAt", "globalEventId"
)
SELECT
    "id", "provider", "agendaId", "sourceId", "reservationId", "title", "subject",
    "startAt", "endAt", "teacher", "room", "campus", "roomsJson", "promotion",
    "groupName", "classesJson", "modality", "reservationType", "studentCount",
    "disciplineName", "disciplineTeacher", "disciplineId", "sourceHash",
    "rawPayload", "lastSeenAt", "createdAt", "updatedAt", "globalEventId"
FROM "EventSnapshot";
DROP TABLE "EventSnapshot";
ALTER TABLE "EventSnapshot_new" RENAME TO "EventSnapshot";
CREATE INDEX "EventSnapshot_startAt_idx" ON "EventSnapshot"("startAt");
CREATE INDEX "EventSnapshot_reservationId_idx" ON "EventSnapshot"("reservationId");
CREATE INDEX "EventSnapshot_provider_startAt_idx" ON "EventSnapshot"("provider", "startAt");
CREATE INDEX "EventSnapshot_agendaId_idx" ON "EventSnapshot"("agendaId");
CREATE INDEX "EventSnapshot_globalEventId_idx" ON "EventSnapshot"("globalEventId");

-- 7. EventMatch, created after EventSnapshot's rebuild so its FK targets the
--    final table. Cascade on both sides per spec: match rows are meta-audit rows
--    tied to the lifetime of the snapshot/global event they describe.
CREATE TABLE "EventMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "globalEventId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchBasis" TEXT NOT NULL,
    "confidence" REAL,
    "reasonJson" TEXT,
    "decidedBy" TEXT,
    "decidedAt" DATETIME NOT NULL,
    CONSTRAINT "EventMatch_globalEventId_fkey" FOREIGN KEY ("globalEventId") REFERENCES "GlobalEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventMatch_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "EventSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EventMatch_globalEventId_idx" ON "EventMatch"("globalEventId");
CREATE INDEX "EventMatch_snapshotId_idx" ON "EventMatch"("snapshotId");
CREATE INDEX "EventMatch_status_idx" ON "EventMatch"("status");

-- 8. Backfill audit trail: one AUTO_LINKED/VERIFIED_IDENTIFIER row per pre-existing
--    snapshot, documenting that this migration seeded it as its own solo
--    GlobalEvent.
INSERT INTO "EventMatch" (
    "id", "globalEventId", "snapshotId", "status", "matchBasis", "confidence",
    "reasonJson", "decidedBy", "decidedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "globalEventId",
    "id",
    'AUTO_LINKED',
    'VERIFIED_IDENTIFIER',
    1.0,
    '{"reason":"backfill: pre-existing snapshot seeded as its own solo GlobalEvent"}',
    'system:migration:20261024120000_reconciliation',
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "EventSnapshot";

-- 9. SyncJobEventChange: per-sync-job change log, appended inline during sync.
CREATE TABLE "SyncJobEventChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncJobId" TEXT NOT NULL,
    "globalEventId" TEXT,
    "snapshotId" TEXT,
    "action" TEXT NOT NULL,
    "googleEventId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "SyncJobEventChange_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SyncJobEventChange_syncJobId_idx" ON "SyncJobEventChange"("syncJobId");
CREATE INDEX "SyncJobEventChange_globalEventId_idx" ON "SyncJobEventChange"("globalEventId");

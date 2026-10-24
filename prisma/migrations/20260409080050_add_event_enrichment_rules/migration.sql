/*
  Warnings:

  - You are about to drop the `MyGesCredential` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MyGesCredential";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "EventEnrichmentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "matchProvider" TEXT,
    "matchClassLike" TEXT,
    "matchSubjectLike" TEXT,
    "matchRoomLike" TEXT,
    "matchKeywords" TEXT,
    "injectProvider" TEXT,
    "injectClass" TEXT,
    "injectSubject" TEXT,
    "injectTeacher" TEXT,
    "injectRoom" TEXT,
    "injectCampus" TEXT,
    "injectStudentCount" INTEGER,
    "injectModality" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "googleEventId" TEXT,
    "lastSyncedHash" TEXT,
    "lastKnownStartAt" DATETIME NOT NULL,
    "lastKnownEndAt" DATETIME NOT NULL,
    "lastAction" TEXT,
    "lastSyncedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventMapping_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "EventSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EventMapping" ("createdAt", "deletedAt", "googleEventId", "id", "lastAction", "lastKnownEndAt", "lastKnownStartAt", "lastSyncedAt", "lastSyncedHash", "provider", "sourceEventId", "updatedAt") SELECT "createdAt", "deletedAt", "googleEventId", "id", "lastAction", "lastKnownEndAt", "lastKnownStartAt", "lastSyncedAt", "lastSyncedHash", "provider", "sourceEventId", "updatedAt" FROM "EventMapping";
DROP TABLE "EventMapping";
ALTER TABLE "new_EventMapping" RENAME TO "EventMapping";
CREATE UNIQUE INDEX "EventMapping_sourceEventId_key" ON "EventMapping"("sourceEventId");
CREATE INDEX "EventMapping_lastKnownStartAt_idx" ON "EventMapping"("lastKnownStartAt");
CREATE INDEX "EventMapping_provider_lastKnownStartAt_idx" ON "EventMapping"("provider", "lastKnownStartAt");
CREATE TABLE "new_EventSnapshot" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_EventSnapshot" ("agendaId", "campus", "classesJson", "createdAt", "disciplineId", "disciplineName", "disciplineTeacher", "endAt", "groupName", "id", "lastSeenAt", "modality", "promotion", "provider", "rawPayload", "reservationId", "reservationType", "room", "roomsJson", "sourceHash", "sourceId", "startAt", "studentCount", "subject", "teacher", "title", "updatedAt") SELECT "agendaId", "campus", "classesJson", "createdAt", "disciplineId", "disciplineName", "disciplineTeacher", "endAt", "groupName", "id", "lastSeenAt", "modality", "promotion", "provider", "rawPayload", "reservationId", "reservationType", "room", "roomsJson", "sourceHash", "sourceId", "startAt", "studentCount", "subject", "teacher", "title", "updatedAt" FROM "EventSnapshot";
DROP TABLE "EventSnapshot";
ALTER TABLE "new_EventSnapshot" RENAME TO "EventSnapshot";
CREATE INDEX "EventSnapshot_startAt_idx" ON "EventSnapshot"("startAt");
CREATE INDEX "EventSnapshot_reservationId_idx" ON "EventSnapshot"("reservationId");
CREATE INDEX "EventSnapshot_provider_startAt_idx" ON "EventSnapshot"("provider", "startAt");
CREATE INDEX "EventSnapshot_agendaId_idx" ON "EventSnapshot"("agendaId");
CREATE TABLE "new_IcsExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_IcsExport" ("eventCount", "generatedAt", "id", "path", "provider", "rangeEnd", "rangeStart") SELECT "eventCount", "generatedAt", "id", "path", "provider", "rangeEnd", "rangeStart" FROM "IcsExport";
DROP TABLE "IcsExport";
ALTER TABLE "new_IcsExport" RENAME TO "IcsExport";
CREATE INDEX "IcsExport_generatedAt_idx" ON "IcsExport"("generatedAt");
CREATE INDEX "IcsExport_provider_generatedAt_idx" ON "IcsExport"("provider", "generatedAt");
CREATE TABLE "new_SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "eventsFetched" INTEGER NOT NULL DEFAULT 0,
    "eventsDeduped" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "exportedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "summary" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);
INSERT INTO "new_SyncJob" ("createdCount", "deletedCount", "dryRun", "errorMessage", "eventsDeduped", "eventsFetched", "exportedCount", "finishedAt", "id", "provider", "rangeEnd", "rangeStart", "startedAt", "status", "summary", "trigger", "unchangedCount", "updatedCount") SELECT "createdCount", "deletedCount", "dryRun", "errorMessage", "eventsDeduped", "eventsFetched", "exportedCount", "finishedAt", "id", "provider", "rangeEnd", "rangeStart", "startedAt", "status", "summary", "trigger", "unchangedCount", "updatedCount" FROM "SyncJob";
DROP TABLE "SyncJob";
ALTER TABLE "new_SyncJob" RENAME TO "SyncJob";
CREATE INDEX "SyncJob_startedAt_idx" ON "SyncJob"("startedAt");
CREATE INDEX "SyncJob_provider_startedAt_idx" ON "SyncJob"("provider", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EventEnrichmentRule_enabled_idx" ON "EventEnrichmentRule"("enabled");

-- CreateIndex
CREATE INDEX "EventEnrichmentRule_matchProvider_idx" ON "EventEnrichmentRule"("matchProvider");

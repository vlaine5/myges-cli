-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncLookbackDays" INTEGER NOT NULL DEFAULT 7,
    "syncFutureDays" INTEGER NOT NULL DEFAULT 30,
    "syncFrequencyMinutes" INTEGER NOT NULL DEFAULT 30,
    "runSyncOnStartup" BOOLEAN NOT NULL DEFAULT false,
    "googleSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "saveLastIcs" BOOLEAN NOT NULL DEFAULT true,
    "storeRawPayload" BOOLEAN NOT NULL DEFAULT false,
    "logLevel" TEXT NOT NULL DEFAULT 'info',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MyGesCredential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "accessToken" TEXT,
    "tokenType" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenType" TEXT,
    "scope" TEXT,
    "expiryDate" DATETIME,
    "connectedEmail" TEXT,
    "calendarId" TEXT,
    "calendarSummary" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EventSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
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

-- CreateTable
CREATE TABLE "EventMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
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

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
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

-- CreateTable
CREATE TABLE "IcsExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EventSnapshot_startAt_idx" ON "EventSnapshot"("startAt");

-- CreateIndex
CREATE INDEX "EventSnapshot_reservationId_idx" ON "EventSnapshot"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMapping_sourceEventId_key" ON "EventMapping"("sourceEventId");

-- CreateIndex
CREATE INDEX "EventMapping_lastKnownStartAt_idx" ON "EventMapping"("lastKnownStartAt");

-- CreateIndex
CREATE INDEX "SyncJob_startedAt_idx" ON "SyncJob"("startedAt");

-- CreateIndex
CREATE INDEX "IcsExport_generatedAt_idx" ON "IcsExport"("generatedAt");


-- Add day-of-week scheduling fields to AppSettings
ALTER TABLE "AppSettings" ADD COLUMN "syncDayOfWeek" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "syncHour" INTEGER NOT NULL DEFAULT 6;

-- Create AgendaConfig table
-- provider: 'myges' | 'myefrei' | 'ensup'
-- fetchMode: 'api' | 'ics'
-- syncDayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat, NULL=no scheduled sync
-- syncHour: 0-23, default 6 (6h00)
CREATE TABLE "AgendaConfig" (
    "id"               TEXT     NOT NULL PRIMARY KEY,
    "name"             TEXT     NOT NULL,
    "provider"         TEXT     NOT NULL,
    "fetchMode"        TEXT     NOT NULL DEFAULT 'api',
    "icsUrlEncrypted"  TEXT,
    "enabled"          BOOLEAN  NOT NULL DEFAULT true,
    "syncEnabled"      BOOLEAN  NOT NULL DEFAULT false,
    "syncDayOfWeek"    INTEGER,
    "syncHour"         INTEGER  NOT NULL DEFAULT 6,
    "lookbackDays"     INTEGER  NOT NULL DEFAULT 7,
    "lookaheadDays"    INTEGER  NOT NULL DEFAULT 30,
    "googleCalendarId" TEXT,
    "lastSyncAt"       DATETIME,
    "lastSyncStatus"   TEXT,
    "lastSyncError"    TEXT,
    "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        DATETIME NOT NULL
);

CREATE INDEX "AgendaConfig_provider_idx" ON "AgendaConfig"("provider");
CREATE INDEX "AgendaConfig_syncEnabled_idx" ON "AgendaConfig"("syncEnabled");

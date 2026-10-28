-- Per-provider weekly sync schedule: on which days and at which local times
-- (AppSettings.timezone) each provider is fetched, and whether the resulting
-- changes are pushed to Google. Replaces the single global minute-interval
-- scheduler that only ever ran the active provider.
--
-- daysJson:  JSON array of weekdays, 0=Sun .. 6=Sat
-- timesJson: JSON array of "HH:MM" local times
-- lastSlotAt: the scheduled slot most recently handled, so a slot runs once
CREATE TABLE "ProviderSchedule" (
    "provider"      TEXT     NOT NULL PRIMARY KEY,
    "enabled"       BOOLEAN  NOT NULL DEFAULT false,
    "daysJson"      TEXT     NOT NULL DEFAULT '[]',
    "timesJson"     TEXT     NOT NULL DEFAULT '[]',
    "pushToGoogle"  BOOLEAN  NOT NULL DEFAULT true,
    "lastSlotAt"    DATETIME,
    "lastRunAt"     DATETIME,
    "lastRunStatus" TEXT,
    "lastRunError"  TEXT,
    "lastJobId"     TEXT,
    "updatedAt"     DATETIME NOT NULL
);

-- Carry an enabled legacy scheduler over as a daily run of the active provider
-- at its configured hour. lastSlotAt = now so no past slot fires on upgrade.
INSERT INTO "ProviderSchedule" ("provider", "enabled", "daysJson", "timesJson", "pushToGoogle", "lastSlotAt", "updatedAt")
SELECT
    "provider",
    true,
    '[0,1,2,3,4,5,6]',
    '["' || printf('%02d', "syncHour") || ':00"]',
    true,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "AppSettings"
WHERE "id" = 1 AND "syncEnabled" = 1;

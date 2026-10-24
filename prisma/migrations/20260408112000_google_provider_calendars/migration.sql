CREATE TABLE "GoogleProviderCalendar" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT,
    "calendarSummary" TEXT,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "GoogleProviderCalendar" ("provider", "calendarId", "calendarSummary", "updatedAt")
SELECT 'myges', "calendarId", "calendarSummary", COALESCE("updatedAt", CURRENT_TIMESTAMP)
FROM "GoogleConnection"
WHERE ("calendarId" IS NOT NULL OR "calendarSummary" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "GoogleProviderCalendar" WHERE "provider" = 'myges');

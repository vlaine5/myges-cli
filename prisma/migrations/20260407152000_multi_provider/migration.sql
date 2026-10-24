ALTER TABLE "AppSettings" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'myges';

CREATE TABLE "AcademicProviderCredential" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "authMode" TEXT,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "accessToken" TEXT,
    "tokenType" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "sessionCookieEncrypted" TEXT,
    "configJson" TEXT,
    "lastLoginAt" DATETIME,
    "lastLoginError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "AcademicProviderCredential" (
    "provider",
    "authMode",
    "username",
    "passwordEncrypted",
    "accessToken",
    "tokenType",
    "accessTokenExpiresAt",
    "lastLoginAt",
    "lastLoginError",
    "updatedAt"
)
SELECT
    'myges',
    CASE
        WHEN "username" IS NOT NULL AND "passwordEncrypted" IS NOT NULL THEN 'password'
        ELSE NULL
    END,
    "username",
    "passwordEncrypted",
    "accessToken",
    "tokenType",
    "accessTokenExpiresAt",
    "lastLoginAt",
    "lastLoginError",
    COALESCE("updatedAt", CURRENT_TIMESTAMP)
FROM "MyGesCredential"
WHERE EXISTS (SELECT 1 FROM "MyGesCredential")
  AND NOT EXISTS (SELECT 1 FROM "AcademicProviderCredential" WHERE "provider" = 'myges');

ALTER TABLE "EventSnapshot" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'myges';
ALTER TABLE "EventSnapshot" ADD COLUMN "sourceId" TEXT NOT NULL DEFAULT '';
UPDATE "EventSnapshot" SET "sourceId" = CASE
    WHEN instr("id", ':') > 0 THEN substr("id", instr("id", ':') + 1)
    ELSE "id"
END
WHERE "sourceId" = '';
CREATE INDEX "EventSnapshot_provider_startAt_idx" ON "EventSnapshot"("provider", "startAt");

ALTER TABLE "EventMapping" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'myges';
UPDATE "EventMapping" SET "provider" = CASE
    WHEN instr("sourceEventId", ':') > 0 THEN substr("sourceEventId", 1, instr("sourceEventId", ':') - 1)
    ELSE 'myges'
END;
CREATE INDEX "EventMapping_provider_lastKnownStartAt_idx" ON "EventMapping"("provider", "lastKnownStartAt");

ALTER TABLE "SyncJob" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'myges';
CREATE INDEX "SyncJob_provider_startedAt_idx" ON "SyncJob"("provider", "startedAt");

ALTER TABLE "IcsExport" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'myges';
CREATE INDEX "IcsExport_provider_generatedAt_idx" ON "IcsExport"("provider", "generatedAt");

-- Create IcsImport table for tracking manual ICS imports
CREATE TABLE "IcsImport" (
    "id"                  TEXT     NOT NULL PRIMARY KEY,
    "name"                TEXT     NOT NULL,
    "sourceType"          TEXT     NOT NULL,
    "provider"            TEXT     NOT NULL,
    "detectedProvider"    TEXT,
    "detectionConfidence" TEXT,
    "icsUrl"              TEXT,
    "originalFilename"    TEXT,
    "status"              TEXT     NOT NULL DEFAULT 'SUCCESS',
    "fetchedCount"        INTEGER  NOT NULL DEFAULT 0,
    "createdCount"        INTEGER  NOT NULL DEFAULT 0,
    "updatedCount"        INTEGER  NOT NULL DEFAULT 0,
    "duplicateCount"      INTEGER  NOT NULL DEFAULT 0,
    "skippedCount"        INTEGER  NOT NULL DEFAULT 0,
    "errorMessage"        TEXT,
    "importedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReimportAt"      DATETIME,
    "updatedAt"           DATETIME NOT NULL
);

CREATE INDEX "IcsImport_importedAt_idx" ON "IcsImport"("importedAt");
CREATE INDEX "IcsImport_provider_idx" ON "IcsImport"("provider");

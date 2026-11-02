CREATE TABLE "PlanningChange" (
    "id"            TEXT     NOT NULL PRIMARY KEY,
    "runId"         TEXT     NOT NULL,
    "provider"      TEXT     NOT NULL,
    "kind"          TEXT     NOT NULL,
    "eventId"       TEXT     NOT NULL,
    "title"         TEXT     NOT NULL,
    "startAt"       DATETIME NOT NULL,
    "changedFields" TEXT,
    "beforeJson"    TEXT,
    "afterJson"     TEXT,
    "detectedAt"    DATETIME NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

CREATE INDEX "PlanningChange_detectedAt_idx" ON "PlanningChange"("detectedAt");
CREATE INDEX "PlanningChange_provider_detectedAt_idx" ON "PlanningChange"("provider", "detectedAt");
CREATE INDEX "PlanningChange_runId_idx" ON "PlanningChange"("runId");

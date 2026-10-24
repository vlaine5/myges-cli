-- Add IcsImportEvent join table for explicit event-to-import traceability
-- This enables: listing events per import, sync semantics on reimport, safe targeted delete
CREATE TABLE "IcsImportEvent" (
    "importId" TEXT NOT NULL,
    "eventId"  TEXT NOT NULL,
    PRIMARY KEY ("importId", "eventId")
);

CREATE INDEX "IcsImportEvent_importId_idx" ON "IcsImportEvent"("importId");
CREATE INDEX "IcsImportEvent_eventId_idx" ON "IcsImportEvent"("eventId");

-- Add removedFutureCount column to IcsImport for reimport tracking
ALTER TABLE "IcsImport" ADD COLUMN "removedFutureCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IcsImport" ADD COLUMN "keptPastCount" INTEGER NOT NULL DEFAULT 0;

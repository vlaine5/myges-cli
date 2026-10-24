-- Add agendaId to EventSnapshot for traceability (links to AgendaConfig.id)
ALTER TABLE "EventSnapshot" ADD COLUMN "agendaId" TEXT;
CREATE INDEX "EventSnapshot_agendaId_idx" ON "EventSnapshot"("agendaId");

-- Planning-change notifications: where to send them (email over SMTP and/or a
-- webhook) and a log of every delivery attempt. Secrets are stored encrypted
-- with APP_SECRET, like provider credentials.
CREATE TABLE "NotificationSettings" (
    "id"                    INTEGER  NOT NULL PRIMARY KEY DEFAULT 1,
    "emailEnabled"          BOOLEAN  NOT NULL DEFAULT false,
    "smtpHost"              TEXT,
    "smtpPort"              INTEGER  NOT NULL DEFAULT 587,
    "smtpSecurity"          TEXT     NOT NULL DEFAULT 'starttls',
    "smtpUser"              TEXT,
    "smtpPasswordEncrypted" TEXT,
    "emailFrom"             TEXT,
    "emailTo"               TEXT,
    "webhookEnabled"        BOOLEAN  NOT NULL DEFAULT false,
    "webhookUrlEncrypted"   TEXT,
    "webhookFormat"         TEXT     NOT NULL DEFAULT 'json',
    "notifyAdded"           BOOLEAN  NOT NULL DEFAULT true,
    "notifyUpdated"         BOOLEAN  NOT NULL DEFAULT true,
    "notifyRemoved"         BOOLEAN  NOT NULL DEFAULT true,
    "horizonDays"           INTEGER  NOT NULL DEFAULT 14,
    "updatedAt"             DATETIME NOT NULL
);

INSERT INTO "NotificationSettings" ("id", "updatedAt")
VALUES (1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));

CREATE TABLE "NotificationLog" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "createdAt"   DATETIME NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
    "provider"    TEXT,
    "channel"     TEXT     NOT NULL,
    "status"      TEXT     NOT NULL,
    "test"        BOOLEAN  NOT NULL DEFAULT false,
    "changeCount" INTEGER  NOT NULL DEFAULT 0,
    "summary"     TEXT     NOT NULL,
    "message"     TEXT,
    "error"       TEXT
);

CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

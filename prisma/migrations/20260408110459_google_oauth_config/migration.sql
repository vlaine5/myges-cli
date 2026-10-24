-- Add Google OAuth credentials storage to GoogleConnection
ALTER TABLE "GoogleConnection" ADD COLUMN "clientIdEncrypted" TEXT;
ALTER TABLE "GoogleConnection" ADD COLUMN "clientSecretEncrypted" TEXT;
ALTER TABLE "GoogleConnection" ADD COLUMN "oauthRedirectUrl" TEXT;

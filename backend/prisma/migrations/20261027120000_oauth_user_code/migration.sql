-- Assistants are approved in the app by a short code. Pending requests are
-- short lived and cannot be finished without one, so they are dropped.
DELETE FROM "OAuthConsent";

ALTER TABLE "OAuthConsent" ADD COLUMN "userCode" TEXT NOT NULL,
ADD COLUMN "request" TEXT NOT NULL,
ADD COLUMN "redirectUrl" TEXT;

CREATE UNIQUE INDEX "OAuthConsent_userCode_key" ON "OAuthConsent"("userCode");

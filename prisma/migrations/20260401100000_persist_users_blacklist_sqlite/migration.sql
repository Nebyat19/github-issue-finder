-- Redefine User to add role/approval/ban columns and keep existing password column.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("id", "email", "password", "role", "isApproved", "isBanned", "isAdmin", "createdAt", "updatedAt")
SELECT
  "id",
  "email",
  "password",
  CASE WHEN "isAdmin" = 1 THEN 'admin' ELSE 'user' END AS "role",
  CASE WHEN "isActive" = 1 THEN 1 ELSE 0 END AS "isApproved",
  0 AS "isBanned",
  "isAdmin",
  "createdAt",
  "updatedAt"
FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Add persistent blacklist table.
CREATE TABLE "Blacklist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "issueNumber" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Blacklist_kind_owner_repo_idx" ON "Blacklist"("kind", "owner", "repo");
CREATE INDEX "Blacklist_owner_repo_issueNumber_idx" ON "Blacklist"("owner", "repo", "issueNumber");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

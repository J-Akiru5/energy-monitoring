-- Migration: super_admins table
-- Creates the platform-level super admin representation.
-- Super admins are deliberately outside the tenancy model (customers/memberships).
-- Rows are never deleted on revocation — revoked_at is set instead, preserving
-- the full audit trail required by decision #24.

CREATE TABLE IF NOT EXISTS super_admins (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ
);

COMMENT ON TABLE super_admins IS 'Platform-level super administrator roles. Revocation sets revoked_at; rows are never deleted.';
COMMENT ON COLUMN super_admins.user_id IS 'The auth.users id of the super admin.';
COMMENT ON COLUMN super_admins.granted_by IS 'Who granted this role (self-granted for bootstrap admin).';
COMMENT ON COLUMN super_admins.revoked_at IS 'NULL = currently active. Non-NULL = revoked at this time.';

-- Index for quick "is this user a super admin?" checks (NULLs excluded by convention — only active rows queried).
CREATE INDEX IF NOT EXISTS idx_super_admins_active ON super_admins (user_id) WHERE revoked_at IS NULL;

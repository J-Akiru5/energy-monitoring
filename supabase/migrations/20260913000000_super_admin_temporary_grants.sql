-- Migration: time-limited super admin grants + temporary-access audit
-- Decision #9: temporary, explicitly-granted, revocable Super Admin access
-- for demo purposes, distinct from permanent Super Admin status.
--
-- expires_at NULL = permanent grant (existing rows unaffected).
-- expires_at set  = temporary/demo grant; access fails closed once passed.

ALTER TABLE super_admins
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN super_admins.expires_at IS
    'NULL = permanent grant. Non-NULL = temporary/demo grant that expires at this time (decision #9).';

-- Minimal audit trail: one row per temporary-grant access resolution.
-- Permanent super admin access is intentionally NOT logged here to avoid
-- noise on legitimate ongoing use.
CREATE TABLE IF NOT EXISTS super_admin_access_log (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    accessed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    was_temporary_grant BOOLEAN NOT NULL
);

COMMENT ON TABLE super_admin_access_log IS
    'Audit trail for temporary super admin grant access (decision #9). Only temporary-grant resolutions are recorded.';

-- Service-role only: RLS enabled with no policies denies anon/authenticated
-- reads and writes; the service role bypasses RLS.
ALTER TABLE super_admin_access_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_super_admin_access_log_user_time
    ON super_admin_access_log (user_id, accessed_at DESC);

-- DRY_RUN: Seed the first Super Admin
-- PLACEHOLDER — Jeff must confirm or edit v_admin_email before running.
-- This script does NOT create an auth.users row. The target account must
-- have signed up (or been created via the Supabase dashboard) first.
--
-- Usage:
--   1. Confirm v_admin_email below matches the desired bootstrap admin account.
--   2. Run in the Supabase SQL Editor (or psql against the project DB).
--   3. Verify: SELECT * FROM super_admins;
--
-- Idempotent: uses ON CONFLICT (user_id) DO UPDATE to safely re-run.

DO $$
DECLARE
    v_admin_email TEXT := 'jeff@syntaxure.dev'; -- CONFIRM THIS
    v_user_id     UUID;
BEGIN
    -- Look up the auth.users row for the target email
    SELECT id INTO v_user_id
      FROM auth.users
     WHERE email = v_admin_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION
            'No auth.users row found for email %. The account must sign up or be created first.',
            v_admin_email;
    END IF;

    -- Upsert into super_admins (self-granted for bootstrap)
    INSERT INTO super_admins (user_id, granted_by, granted_at)
    VALUES (v_user_id, v_user_id, NOW())
    ON CONFLICT (user_id) DO UPDATE
        SET granted_at = EXCLUDED.granted_at;

    RAISE NOTICE 'Seeded super_admins for user % (id: %)', v_admin_email, v_user_id;
END
$$;

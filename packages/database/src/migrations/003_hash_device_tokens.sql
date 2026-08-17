-- ═══════════════════════════════════════════════════════════════════
-- ONE-TIME MIGRATION: hash raw device tokens already stored in the DB.
--
-- ⚠ ORDERING TRAP — READ BEFORE RUNNING ⚠
-- `devices.api_key_hash` currently stores the RAW token
-- (e.g. "em_<uuid>"), not a hash. The application code now hashes the
-- incoming X-Device-Token (SHA-256 hex, see queries/devices.ts) before
-- comparing against this column. Therefore this migration MUST be run
-- against every environment (dev + prod) BEFORE the new app code is
-- deployed — otherwise every existing device gets 401s until it runs.
--
-- Run it in the Supabase SQL editor (or psql). It is idempotent: rows
-- already holding a 64-char SHA-256 hex digest are left untouched, so
-- running it twice is harmless.
--
-- New devices registered after deploy store the hash automatically via
-- registerDevice(); this script only rewrites pre-existing rows.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE devices
SET api_key_hash = encode(digest(api_key_hash, 'sha256'), 'hex')
WHERE api_key_hash IS NOT NULL
  AND length(api_key_hash) < 64;  -- skip rows already hashed

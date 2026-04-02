-- ═══════════════════════════════════════════════════════════════
-- SAFE MIGRATION 002: Alert Incident Tracking
-- Energy Monitoring System
--
-- Prerequisites:
--   Run FIRST in Supabase SQL Editor before this migration:
--   CREATE TABLE alerts_backup_pre_incident AS SELECT * FROM alerts;
--   SELECT COUNT(*) FROM alerts_backup_pre_incident; -- verify row count
--
-- SAFETY GUARANTEES:
--   ✓ ADD COLUMN IF NOT EXISTS  → non-destructive, existing rows unaffected
--   ✓ CREATE TABLE IF NOT EXISTS → idempotent, safe to run twice
--   ✓ CREATE INDEX IF NOT EXISTS → idempotent
--   ✓ Cleanup uses UPDATE only  → rows are never deleted
--   ✗ NO DROP / TRUNCATE / DELETE statements
--
-- To UNDO the cleanup step only (restore dismissed alerts):
--   UPDATE alerts SET is_read = false
--   WHERE id IN (SELECT id FROM alerts_backup_pre_incident WHERE is_read = false);
-- ═══════════════════════════════════════════════════════════════


-- ──── Part A: Extend alerts table with incident time-range fields ─────
-- These columns transform each alert from a point-in-time event into a
-- duration-aware record, enabling the "Phase C: 0V from Apr 1 → Apr 3" display.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS phase TEXT;
-- 'A', 'B', 'C' for per-phase alerts. NULL for single-phase / totals.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS is_incident BOOLEAN NOT NULL DEFAULT false;
-- false = transient spike (resolved before the 60s promotion window)
-- true  = sustained incident (promoted because fault persisted ≥60 seconds)

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
-- NULL  = incident is currently ONGOING
-- Stamped when the 30s recovery debounce completes and the incident is closed.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
-- Calculated on close: EXTRACT(EPOCH FROM (ended_at - created_at))::INTEGER


-- ──── Part B: New alert incident state tracking table ─────────────────
-- One row per (device_id, alert_type, phase) tuple.
-- Tracks whether a given fault type is currently in an active incident.
-- The empty string '' is used for `phase` when not applicable (single-phase,
-- PZEM_OFFLINE, HIGH_POWER totals) to enable a simple UNIQUE constraint.

CREATE TABLE IF NOT EXISTS device_alert_state (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id            UUID        NOT NULL REFERENCES devices(id),
  alert_type           TEXT        NOT NULL,
  phase                TEXT        NOT NULL DEFAULT '',
  --   ''        → no-phase (PZEM_OFFLINE, HIGH_POWER total, single-phase)
  --   'A'|'B'|'C' → per-phase 3-phase incidents
  is_active            BOOLEAN     NOT NULL DEFAULT false,
  in_recovery          BOOLEAN     NOT NULL DEFAULT false,
  --   in_recovery = true: fault cleared, waiting 30s debounce before closing
  current_alert_id     UUID        REFERENCES alerts(id),
  started_at           TIMESTAMPTZ,
  recovery_started_at  TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, alert_type, phase)
);

CREATE INDEX IF NOT EXISTS idx_device_alert_state_active
  ON device_alert_state (device_id, is_active)
  WHERE is_active = true;


-- ──── Part C: Safe cleanup of existing duplicate unread alerts ────────
-- Groups unread alerts by (device_id, alert_type, clock-hour) and marks
-- all but the FIRST occurrence as is_read = true.
-- This de-noises the alert list without erasing historical data.

WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY device_id, type, DATE_TRUNC('hour', created_at)
      ORDER BY created_at ASC
    ) AS rn
  FROM alerts
  WHERE is_read = false
)
UPDATE alerts
SET is_read = true
WHERE id IN (
  SELECT id FROM ranked_duplicates WHERE rn > 1
);


-- ──── Verification Queries ─────────────────────────────────────────────
-- Uncomment and run these after applying the migration.

-- 1. Confirm all 4 new columns exist:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'alerts'
--   AND column_name IN ('phase', 'is_incident', 'ended_at', 'duration_seconds');

-- 2. Confirm state tracking table was created:
-- SELECT COUNT(*) FROM device_alert_state;   -- Expects 0 (no incidents yet)

-- 3. Check how many unread alerts remain after cleanup:
-- SELECT COUNT(*) as unread_remaining FROM alerts WHERE is_read = false;

-- 4. Verify backup table exists and has all rows:
-- SELECT COUNT(*) FROM alerts_backup_pre_incident;
-- (Should equal: SELECT COUNT(*) FROM alerts;)

-- ══════════════════════════════════════════════════════════════
-- PHASE 3b.3 — RLS: membership-scoped read policies, slice two
-- Energy Monitoring System
--
-- Enables RLS + a single "members read own customer" SELECT policy on
-- the 5 remaining telemetry tables: alerts, relay_logs, blackout_events,
-- device_alert_state, and devices.
--
-- This is a BACKSTOP, not the primary isolation mechanism for the app
-- today: every current query in this codebase runs through
-- getSupabaseAdmin() (service role), which ALWAYS bypasses RLS. The
-- actual isolation for API routes comes from explicit
-- .eq('customer_id', ...) filtering in application code (see
-- packages/database/src/queries/*.ts + packages/auth/src/access.ts).
-- These policies exist so that any future code path using a
-- user-context client (anon key + user JWT) is protected too, and so
-- a service-role bug doesn't leave the DB itself wide open.
--
-- Scope: SELECT only. This slice is about reads (view_energy). Write
-- policies (INSERT/UPDATE/DELETE) for OWNER/ADMIN/OPERATOR roles are
-- explicitly out of scope — follow-up task.
--
-- Postgres has no CREATE POLICY IF NOT EXISTS, so every policy is
-- dropped and recreated for safe re-runs.
-- ══════════════════════════════════════════════════════════════

-- ──── alerts ─────────────────────────────────────────────────
-- Has customer_id (added by Phase 3a additive columns migration).
-- The telemetry-stamp pattern: same as power_readings.
-- NOTE: historical rows recorded before Phase 3a backfill may have
-- customer_id = NULL — those rows are invisible under this policy to
-- every non-service-role caller (NULL never matches an `IN` list).
-- That's a deliberate fail-closed default, not a bug.
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON alerts;
CREATE POLICY "members read own customer" ON alerts
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── relay_logs ─────────────────────────────────────────────
-- Has customer_id (added by Phase 3a additive columns migration).
ALTER TABLE relay_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON relay_logs;
CREATE POLICY "members read own customer" ON relay_logs
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── blackout_events ────────────────────────────────────────
-- Has customer_id (added by Phase 3a additive columns migration).
ALTER TABLE blackout_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON blackout_events;
CREATE POLICY "members read own customer" ON blackout_events
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── device_alert_state ─────────────────────────────────────
-- Has customer_id (added by Phase 3a additive columns migration).
ALTER TABLE device_alert_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON device_alert_state;
CREATE POLICY "members read own customer" ON device_alert_state
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── devices ────────────────────────────────────────────────
-- No customer_id column (legacy pre-Phase-3a root entity).
-- Scoping walks the controllers bridge:
--   devices ← controllers.legacy_device_id → controllers.emu_id →
--   emus.owner_customer_id → memberships.customer_id
--
-- This is the same path used by:
--   - packages/database/src/queries/tenant.ts (lookupControllerByDevice)
--   - packages/database/src/queries/devices.ts (listDevices)
--   - RLS policy on controllers (slice one, 20260910220000)
--
-- NOTE: devices that have no linked controller (orphans, pre-backfill)
-- are invisible under this policy to every non-service-role caller.
-- That's a deliberate fail-closed default — unlinked devices shouldn't
-- be accessible to any customer.
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON devices;
CREATE POLICY "members read own customer" ON devices
  FOR SELECT USING (
    id IN (
      SELECT legacy_device_id FROM controllers
      WHERE emu_id IN (
        SELECT id FROM emus
        WHERE owner_customer_id IN (
          SELECT customer_id FROM memberships WHERE user_id = auth.uid()
        )
      )
    )
  );

-- ══════════════════════════════════════════════════════════════
-- PHASE 3b.3 — RLS: membership-scoped read policies, slice one
-- Energy Monitoring System
--
-- Enables RLS + a single "members read own customer" SELECT policy on
-- the 7 core tables in the customer → site → building → EMU →
-- controller → power_readings chain.
--
-- This is a BACKSTOP, not the primary isolation mechanism for the app
-- today: every current query in this codebase runs through
-- getSupabaseAdmin() (service role), which ALWAYS bypasses RLS. The
-- actual isolation for /api/readings comes from explicit
-- .eq('customer_id', ...) filtering in application code (see
-- packages/database/src/queries/readings.ts + packages/auth/src/access.ts).
-- These policies exist so that any future code path using a
-- user-context client (anon key + user JWT) is protected too, and so
-- a service-role bug doesn't leave the DB itself wide open.
--
-- Scope: SELECT only. This slice is about reads (view_energy). Write
-- policies (INSERT/UPDATE/DELETE) for OWNER/ADMIN/OPERATOR roles are
-- explicitly out of scope — follow-up task, same as the other 8 query
-- files and remaining tables.
--
-- Postgres has no CREATE POLICY IF NOT EXISTS, so every policy is
-- dropped and recreated for safe re-runs.
-- ══════════════════════════════════════════════════════════════

-- ──── customers ──────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON customers;
CREATE POLICY "members read own customer" ON customers
  FOR SELECT USING (
    id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── sites ──────────────────────────────────────────────────
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON sites;
CREATE POLICY "members read own customer" ON sites
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── buildings ──────────────────────────────────────────────
-- No direct customer_id column — scope through sites.
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON buildings;
CREATE POLICY "members read own customer" ON buildings
  FOR SELECT USING (
    site_id IN (
      SELECT id FROM sites
      WHERE customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
    )
  );

-- ──── emus ───────────────────────────────────────────────────
ALTER TABLE emus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON emus;
CREATE POLICY "members read own customer" ON emus
  FOR SELECT USING (
    owner_customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── controllers ────────────────────────────────────────────
-- No direct customer_id column — scope through emus.
ALTER TABLE controllers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON controllers;
CREATE POLICY "members read own customer" ON controllers
  FOR SELECT USING (
    emu_id IN (
      SELECT id FROM emus
      WHERE owner_customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
    )
  );

-- ──── emu_installations ──────────────────────────────────────
ALTER TABLE emu_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON emu_installations;
CREATE POLICY "members read own customer" ON emu_installations
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ──── power_readings ─────────────────────────────────────────
-- The telemetry-stamp table this slice's negative test targets.
-- NOTE: historical rows recorded before Phase 3a backfill may have
-- customer_id = NULL — those rows are invisible under this policy to
-- every non-service-role caller (NULL never matches an `IN` list).
-- That's a deliberate fail-closed default, not a bug.
ALTER TABLE power_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customer" ON power_readings;
CREATE POLICY "members read own customer" ON power_readings
  FOR SELECT USING (
    customer_id IN (SELECT customer_id FROM memberships WHERE user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════
-- SAFE MIGRATION: Relay Controller Tables
-- Run this in Supabase SQL Editor
--
-- SAFETY:
-- - Uses CREATE TABLE IF NOT EXISTS (won't recreate existing tables)
-- - Uses CREATE INDEX IF NOT EXISTS (won't fail on existing indexes)
-- - Uses INSERT ... ON CONFLICT DO NOTHING (won't overwrite existing data)
-- - NO DROP statements
-- - NO TRUNCATE statements
-- - NO DELETE statements
--
-- This script is IDEMPOTENT - safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════

-- ──── Relay Controller Configuration ─────────────────────────
-- Stores per-device relay control settings
CREATE TABLE IF NOT EXISTS relay_config (
  id SERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) UNIQUE,
  relay_enabled BOOLEAN DEFAULT false,
  auto_trip_enabled BOOLEAN DEFAULT false,
  auto_reset_enabled BOOLEAN DEFAULT false,
  auto_reset_delay_seconds INTEGER DEFAULT 300,
  trip_on_overvoltage BOOLEAN DEFAULT true,
  trip_on_undervoltage BOOLEAN DEFAULT true,
  trip_on_overcurrent BOOLEAN DEFAULT true,
  trip_on_blackout BOOLEAN DEFAULT false,
  manual_control_allowed BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──── Relay State (Current State) ────────────────────────────
-- Tracks current relay state per device (tripped or normal)
CREATE TABLE IF NOT EXISTS relay_state (
  id SERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) UNIQUE,
  is_tripped BOOLEAN DEFAULT false,
  last_trip_at TIMESTAMPTZ,
  last_reset_at TIMESTAMPTZ,
  trip_reason TEXT,
  trip_alert_id UUID REFERENCES alerts(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──── Relay Action Log (Audit Trail) ─────────────────────────
-- Complete audit log of all relay actions for compliance and debugging
CREATE TABLE IF NOT EXISTS relay_logs (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id),
  action TEXT NOT NULL,
  trigger_type TEXT,
  trigger_value NUMERIC,
  threshold_value NUMERIC,
  alert_id UUID REFERENCES alerts(id),
  initiated_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──── Indexes for Performance ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_relay_logs_device_time
  ON relay_logs (device_id, created_at DESC);

-- ──── Seed default relay config for existing devices ─────────
-- Uses ON CONFLICT DO NOTHING to avoid overwriting existing configs
INSERT INTO relay_config (device_id, relay_enabled, auto_trip_enabled)
SELECT id, false, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO relay_state (device_id, is_tripped)
SELECT id, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

-- ──── Enable Realtime for relay_state table ──────────────────
-- This allows ESP32 to receive instant WebSocket notifications
-- NOTE: You may also need to enable this in Supabase Dashboard:
--       Database → Replication → Enable for relay_state table

-- Check if publication exists, create if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Add relay_state to the realtime publication (safe to run multiple times)
ALTER PUBLICATION supabase_realtime ADD TABLE relay_state;

-- ──── Row Level Security (RLS) Policies ──────────────────────
-- Enable RLS on relay tables
ALTER TABLE relay_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role (backend) full access
-- These policies allow the backend to manage relay state
-- ESP32 only reads via Realtime (anon key has read access)

-- Policy: Service role can do anything on relay_config
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'service_role_relay_config'
  ) THEN
    CREATE POLICY service_role_relay_config ON relay_config
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- Policy: Authenticated users can read relay_config
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'authenticated_read_relay_config'
  ) THEN
    CREATE POLICY authenticated_read_relay_config ON relay_config
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;

-- Policy: Service role can do anything on relay_state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'service_role_relay_state'
  ) THEN
    CREATE POLICY service_role_relay_state ON relay_state
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- Policy: Anyone can read relay_state (needed for ESP32 via Realtime)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_relay_state'
  ) THEN
    CREATE POLICY anon_read_relay_state ON relay_state
      FOR SELECT
      TO anon
      USING (true);
  END IF;
END
$$;

-- Policy: Authenticated users can read relay_state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'authenticated_read_relay_state'
  ) THEN
    CREATE POLICY authenticated_read_relay_state ON relay_state
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;

-- Policy: Service role can do anything on relay_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'service_role_relay_logs'
  ) THEN
    CREATE POLICY service_role_relay_logs ON relay_logs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- Policy: Authenticated users can read relay_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'authenticated_read_relay_logs'
  ) THEN
    CREATE POLICY authenticated_read_relay_logs ON relay_logs
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run these to verify the migration)
-- ═══════════════════════════════════════════════════════════════

-- Check tables exist:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'relay%';

-- Check relay_config has data:
-- SELECT * FROM relay_config;

-- Check relay_state has data:
-- SELECT * FROM relay_state;

-- Check realtime is enabled:
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- ═══════════════════════════════════════════════════════════════
-- POST-MIGRATION: Enable Realtime in Supabase Dashboard
-- ═══════════════════════════════════════════════════════════════
--
-- 1. Go to Supabase Dashboard → Database → Replication
-- 2. Find "relay_state" table
-- 3. Enable "Realtime" toggle for this table
-- 4. This allows ESP32 to receive WebSocket notifications
--
-- ═══════════════════════════════════════════════════════════════

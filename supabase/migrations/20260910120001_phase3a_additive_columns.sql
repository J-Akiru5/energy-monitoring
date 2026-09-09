-- ══════════════════════════════════════════════════════════════
-- PHASE 3a — Additive Columns: tenant stamping on existing tables
-- Energy Monitoring System
--
-- Adds nullable foreign-key columns to 5 existing tables so
-- telemetry rows can be stamped with their owning customer/EMU.
--
-- SAFETY: All ALTERs use ADD COLUMN IF NOT EXISTS.
-- All new columns are NULLABLE — existing rows are unaffected.
-- No existing columns are modified or dropped.
-- ══════════════════════════════════════════════════════════════

-- ──── power_readings ────────────────────────────────────────
-- 5 new nullable FK columns + 1 config column.
-- Backfill populates these for historical WVSU data.
ALTER TABLE power_readings ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE power_readings ADD COLUMN IF NOT EXISTS emu_id UUID REFERENCES emus(id);
ALTER TABLE power_readings ADD COLUMN IF NOT EXISTS installation_id UUID REFERENCES emu_installations(id);
ALTER TABLE power_readings ADD COLUMN IF NOT EXISTS controller_id UUID REFERENCES controllers(id);
ALTER TABLE power_readings ADD COLUMN IF NOT EXISTS phase_config TEXT;
--   'SINGLE_PHASE' | 'THREE_PHASE' — snapshot of EMU config at recording time

CREATE INDEX IF NOT EXISTS idx_readings_customer_time
  ON power_readings (customer_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_readings_emu
  ON power_readings (emu_id);

-- ──── alerts ─────────────────────────────────────────────────
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS emu_id UUID REFERENCES emus(id);

CREATE INDEX IF NOT EXISTS idx_alerts_customer
  ON alerts (customer_id);

-- ──── relay_logs ─────────────────────────────────────────────
ALTER TABLE relay_logs ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE relay_logs ADD COLUMN IF NOT EXISTS emu_id UUID REFERENCES emus(id);

CREATE INDEX IF NOT EXISTS idx_relay_logs_customer
  ON relay_logs (customer_id);

-- ──── blackout_events ────────────────────────────────────────
ALTER TABLE blackout_events ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE blackout_events ADD COLUMN IF NOT EXISTS emu_id UUID REFERENCES emus(id);

CREATE INDEX IF NOT EXISTS idx_blackout_events_customer
  ON blackout_events (customer_id);

-- ──── device_alert_state ─────────────────────────────────────
ALTER TABLE device_alert_state ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE device_alert_state ADD COLUMN IF NOT EXISTS emu_id UUID REFERENCES emus(id);

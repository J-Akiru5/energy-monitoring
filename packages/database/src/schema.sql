-- ══════════════════════════════════════════════════════════════
-- Energy Monitoring System — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor to bootstrap the database.
-- ══════════════════════════════════════════════════════════════

-- ──── Devices ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  location TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ──── Power Readings (Append-Only, Single Phase) ────────────
CREATE TABLE IF NOT EXISTS power_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id),
  voltage NUMERIC(6,2),
  current_amp NUMERIC(6,3),
  power_w NUMERIC(8,2),
  energy_kwh NUMERIC(10,4),
  frequency NUMERIC(5,2),
  power_factor NUMERIC(4,3),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup for 24h queries on dashboard
CREATE INDEX IF NOT EXISTS idx_readings_device_time
  ON power_readings (device_id, recorded_at DESC);

-- ──── Alerts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  type TEXT NOT NULL,
  value NUMERIC,
  threshold NUMERIC,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_device_unread
  ON alerts (device_id, is_read, created_at DESC);

-- ──── Billing Config ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_config (
  id SERIAL PRIMARY KEY,
  rate_php_per_kwh NUMERIC(6,4) NOT NULL DEFAULT 10.0000,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default billing rate
INSERT INTO billing_config (rate_php_per_kwh)
  VALUES (10.0000)
  ON CONFLICT DO NOTHING;

-- ──── Alert Thresholds ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_thresholds (
  id SERIAL PRIMARY KEY,
  overvoltage NUMERIC DEFAULT 250,
  undervoltage NUMERIC DEFAULT 200,
  overcurrent NUMERIC DEFAULT 80,
  high_power NUMERIC DEFAULT 20000,
  device_offline_seconds INTEGER DEFAULT 60,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults
INSERT INTO alert_thresholds (overvoltage, undervoltage, overcurrent, high_power)
  VALUES (250, 200, 80, 20000)
  ON CONFLICT DO NOTHING;

-- ──── Relay Controller Configuration ─────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_relay_logs_device_time
  ON relay_logs (device_id, created_at DESC);

-- Seed default relay config for existing devices
INSERT INTO relay_config (device_id, relay_enabled, auto_trip_enabled)
SELECT id, false, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO relay_state (device_id, is_tripped)
SELECT id, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- BASELINE: Energy Monitoring System — Full Schema
-- This is the Supabase CLI baseline migration, representing the
-- complete live schema as of 2026-09-10. All future changes
-- should be made via `supabase migration new <name>`, not by
-- editing this file or the hand-written files in
-- packages/database/src/migrations/.
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

-- ──── Power Readings (Append-Only, Single & 3-Phase) ─────────
CREATE TABLE IF NOT EXISTS power_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id),
  voltage NUMERIC(6,2),
  current_amp NUMERIC(6,3),
  power_w NUMERIC(8,2),
  energy_kwh NUMERIC(10,4),
  frequency NUMERIC(5,2),
  power_factor NUMERIC(4,3),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voltage_a NUMERIC(6,2),
  voltage_b NUMERIC(6,2),
  voltage_c NUMERIC(6,2),
  current_a NUMERIC(6,3),
  current_b NUMERIC(6,3),
  current_c NUMERIC(6,3),
  power_a NUMERIC(8,2),
  power_b NUMERIC(8,2),
  power_c NUMERIC(8,2),
  energy_a NUMERIC(10,4),
  energy_b NUMERIC(10,4),
  energy_c NUMERIC(10,4),
  frequency_a NUMERIC(5,2),
  frequency_b NUMERIC(5,2),
  frequency_c NUMERIC(5,2),
  power_factor_a NUMERIC(4,3),
  power_factor_b NUMERIC(4,3),
  power_factor_c NUMERIC(4,3),
  total_power NUMERIC(10,2),
  total_energy NUMERIC(12,4)
);

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  phase TEXT,
  is_incident BOOLEAN NOT NULL DEFAULT false,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_alerts_device_unread
  ON alerts (device_id, is_read, created_at DESC);

-- ──── Billing Config ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_config (
  id SERIAL PRIMARY KEY,
  rate_php_per_kwh NUMERIC(6,4) NOT NULL DEFAULT 10.0000,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

INSERT INTO relay_config (device_id, relay_enabled, auto_trip_enabled)
SELECT id, false, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO relay_state (device_id, is_tripped)
SELECT id, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

-- ──── Alert Incident State ───────────────────────────────────
CREATE TABLE IF NOT EXISTS device_alert_state (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id            UUID        NOT NULL REFERENCES devices(id),
  alert_type           TEXT        NOT NULL,
  phase                TEXT        NOT NULL DEFAULT '',
  is_active            BOOLEAN     NOT NULL DEFAULT false,
  in_recovery          BOOLEAN     NOT NULL DEFAULT false,
  current_alert_id     UUID        REFERENCES alerts(id),
  started_at           TIMESTAMPTZ,
  recovery_started_at  TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, alert_type, phase)
);

CREATE INDEX IF NOT EXISTS idx_device_alert_state_active
  ON device_alert_state (device_id, is_active)
  WHERE is_active = true;

-- ──── Blackout Events ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blackout_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  alert_id UUID REFERENCES alerts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blackout_events_device_time
  ON blackout_events (device_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_blackout_events_active
  ON blackout_events (device_id)
  WHERE ended_at IS NULL;

-- ──── Device Blackout State ──────────────────────────────────
CREATE TABLE IF NOT EXISTS device_blackout_state (
  device_id UUID PRIMARY KEY REFERENCES devices(id),
  in_blackout BOOLEAN DEFAULT false,
  current_blackout_id UUID REFERENCES blackout_events(id),
  blackout_started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO device_blackout_state (device_id, in_blackout)
SELECT id, false FROM devices
ON CONFLICT (device_id) DO NOTHING;

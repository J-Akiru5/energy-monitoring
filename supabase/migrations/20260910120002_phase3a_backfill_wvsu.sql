-- ══════════════════════════════════════════════════════════════
-- PHASE 3a — Backfill WVSU as Customer #1
-- Energy Monitoring System
--
-- Creates the initial tenant hierarchy for WVSU and links all
-- existing devices/telemetry to it.
--
-- PREREQUISITES:
--   1. Run 20260910120000_phase3a_tenant_schema.sql first
--   2. Run 20260910120001_phase3a_additive_columns.sql second
--   3. The pgcrypto extension must be enabled:
--      CREATE EXTENSION IF NOT EXISTS pgcrypto;
--
-- CONFIRMED VALUES (Jeff confirmed 2026-09-10):
--   - Site name: 'WVSU Pototan Campus' — confirmed by Jeff
--   - Phase mode: 'THREE_PHASE' (line ~55)
--     Based on firmware config.h which hardcodes 3 PZEM sensors.
--     If any device is single-phase, change this to 'SINGLE_PHASE'
--     or split the logic per-device.
--
-- SAFETY: This script is idempotent for the customer/site/building
-- creation (uses SELECT to avoid duplicates). Device-level inserts
-- use ON CONFLICT DO NOTHING to prevent duplicate backfills.
--
-- This script queries the actual devices table at runtime.
-- It does NOT hardcode device counts or names.
-- ══════════════════════════════════════════════════════════════

-- Ensure pgcrypto is available for SHA-256 hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_customer_id    UUID;
  v_site_id        UUID;
  v_building_id    UUID;
  v_device         RECORD;
  v_emu_id         UUID;
  v_controller_id  UUID;
  v_installation_id UUID;
  v_device_count   INTEGER;
  v_phase_mode     TEXT := 'THREE_PHASE';
  -- ══════════════════════════════════════════════════════════
  -- CONFIRMED by Jeff: WVSU Pototan Campus
  -- ══════════════════════════════════════════════════════════
  v_site_name      TEXT := 'WVSU Pototan Campus';
  v_building_name  TEXT := 'CICT Building';
BEGIN
  -- ── Count existing devices ──────────────────────────────────
  SELECT COUNT(*) INTO v_device_count FROM devices;

  IF v_device_count = 0 THEN
    RAISE NOTICE 'PHASE 3a BACKFILL: No devices found. Skipping backfill.';
    RETURN;
  END IF;

  RAISE NOTICE 'PHASE 3a BACKFILL: Found % device(s). Creating tenant hierarchy...', v_device_count;

  -- ── Create Customer (WVSU) ──────────────────────────────────
  -- Idempotent: only insert if no customer with this name exists
  SELECT id INTO v_customer_id
  FROM customers
  WHERE name = 'Western Visayas State University'
    AND type = 'ORGANIZATION'
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (name, type, status)
    VALUES ('Western Visayas State University', 'ORGANIZATION', 'ACTIVE')
    RETURNING id INTO v_customer_id;
    RAISE NOTICE '  Created customer: WVSU (%)', v_customer_id;
  ELSE
    RAISE NOTICE '  Customer WVSU already exists: %', v_customer_id;
  END IF;

  -- ── Create Site ─────────────────────────────────────────────
  SELECT id INTO v_site_id
  FROM sites
  WHERE customer_id = v_customer_id
    AND name = v_site_name
  LIMIT 1;

  IF v_site_id IS NULL THEN
    INSERT INTO sites (customer_id, name)
    VALUES (v_customer_id, v_site_name)
    RETURNING id INTO v_site_id;
    RAISE NOTICE '  Created site: % (%)', v_site_name, v_site_id;
  ELSE
    RAISE NOTICE '  Site already exists: %', v_site_id;
  END IF;

  -- ── Create Building (CICT) ──────────────────────────────────
  SELECT id INTO v_building_id
  FROM buildings
  WHERE site_id = v_site_id
    AND name = v_building_name
  LIMIT 1;

  IF v_building_id IS NULL THEN
    INSERT INTO buildings (site_id, name)
    VALUES (v_site_id, v_building_name)
    RETURNING id INTO v_building_id;
    RAISE NOTICE '  Created building: % (%)', v_building_name, v_building_id;
  ELSE
    RAISE NOTICE '  Building already exists: %', v_building_id;
  END IF;

  -- ── Create EMU + Controller + Installation per device ───────
  FOR v_device IN SELECT id, name, api_key_hash, created_at FROM devices ORDER BY created_at LOOP
    -- EMU (reuse device name as label)
    SELECT id INTO v_emu_id
    FROM emus
    WHERE label = v_device.name
      AND owner_customer_id = v_customer_id
    LIMIT 1;

    IF v_emu_id IS NULL THEN
      INSERT INTO emus (label, owner_type, owner_customer_id, status)
      VALUES (v_device.name, 'CUSTOMER', v_customer_id, 'ACTIVE')
      RETURNING id INTO v_emu_id;
      RAISE NOTICE '    Created EMU: % (%)', v_device.name, v_emu_id;
    ELSE
      RAISE NOTICE '    EMU already exists: %', v_emu_id;
    END IF;

    -- Controller (SHA-256 of api_key_hash, with legacy bridge)
    SELECT id INTO v_controller_id
    FROM controllers
    WHERE legacy_device_id = v_device.id
    LIMIT 1;

    IF v_controller_id IS NULL THEN
      INSERT INTO controllers (emu_id, token_hash, legacy_device_id, status, provisioned_at)
      VALUES (
        v_emu_id,
        encode(digest(v_device.api_key_hash, 'sha256'), 'hex'),
        v_device.id,
        'ACTIVE',
        v_device.created_at
      )
      RETURNING id INTO v_controller_id;
      RAISE NOTICE '    Created controller for device %', v_device.id;
    ELSE
      RAISE NOTICE '    Controller already exists: %', v_controller_id;
    END IF;

    -- Installation (EMU placed in CICT Building)
    SELECT id INTO v_installation_id
    FROM emu_installations
    WHERE emu_id = v_emu_id
      AND building_id = v_building_id
      AND ended_at IS NULL
    LIMIT 1;

    IF v_installation_id IS NULL THEN
      INSERT INTO emu_installations (emu_id, customer_id, site_id, building_id, started_at)
      VALUES (v_emu_id, v_customer_id, v_site_id, v_building_id, v_device.created_at)
      RETURNING id INTO v_installation_id;
      RAISE NOTICE '    Created installation: %', v_installation_id;
    ELSE
      RAISE NOTICE '    Installation already exists: %', v_installation_id;
    END IF;

    -- EMU Configuration (phase mode)
    IF NOT EXISTS (
      SELECT 1 FROM emu_configurations WHERE emu_id = v_emu_id AND ended_at IS NULL
    ) THEN
      INSERT INTO emu_configurations (emu_id, phase_mode, started_at)
      VALUES (v_emu_id, v_phase_mode, v_device.created_at);
      RAISE NOTICE '    Created EMU configuration: %', v_phase_mode;
    END IF;

    -- ── Stamp existing telemetry rows ─────────────────────────

    -- power_readings
    UPDATE power_readings
    SET customer_id    = v_customer_id,
        emu_id         = v_emu_id,
        installation_id = v_installation_id,
        controller_id  = v_controller_id,
        phase_config   = v_phase_mode
    WHERE device_id = v_device.id
      AND customer_id IS NULL;

    RAISE NOTICE '    Stamped power_readings for device %', v_device.id;

    -- alerts
    UPDATE alerts
    SET customer_id = v_customer_id,
        emu_id      = v_emu_id
    WHERE device_id = v_device.id
      AND customer_id IS NULL;

    -- relay_logs
    UPDATE relay_logs
    SET customer_id = v_customer_id,
        emu_id      = v_emu_id
    WHERE device_id = v_device.id
      AND customer_id IS NULL;

    -- blackout_events
    UPDATE blackout_events
    SET customer_id = v_customer_id,
        emu_id      = v_emu_id
    WHERE device_id = v_device.id
      AND customer_id IS NULL;

    -- device_alert_state
    UPDATE device_alert_state
    SET customer_id = v_customer_id,
        emu_id      = v_emu_id
    WHERE device_id = v_device.id
      AND customer_id IS NULL;

  END LOOP;

  RAISE NOTICE 'PHASE 3a BACKFILL: Complete.';

  -- ── Verification counts ─────────────────────────────────────
  RAISE NOTICE '  Customers: %', (SELECT COUNT(*) FROM customers);
  RAISE NOTICE '  Sites:     %', (SELECT COUNT(*) FROM sites);
  RAISE NOTICE '  Buildings: %', (SELECT COUNT(*) FROM buildings);
  RAISE NOTICE '  EMUs:      %', (SELECT COUNT(*) FROM emus);
  RAISE NOTICE '  Controllers: %', (SELECT COUNT(*) FROM controllers);
  RAISE NOTICE '  Installations: %', (SELECT COUNT(*) FROM emu_installations);
  RAISE NOTICE '  EMU Configs: %', (SELECT COUNT(*) FROM emu_configurations);
  RAISE NOTICE '  power_readings stamped: %', (SELECT COUNT(*) FROM power_readings WHERE customer_id IS NOT NULL);
  RAISE NOTICE '  alerts stamped: %', (SELECT COUNT(*) FROM alerts WHERE customer_id IS NOT NULL);
  RAISE NOTICE '  relay_logs stamped: %', (SELECT COUNT(*) FROM relay_logs WHERE customer_id IS NOT NULL);
  RAISE NOTICE '  blackout_events stamped: %', (SELECT COUNT(*) FROM blackout_events WHERE customer_id IS NOT NULL);
  RAISE NOTICE '  device_alert_state stamped: %', (SELECT COUNT(*) FROM device_alert_state WHERE customer_id IS NOT NULL);

END $$;

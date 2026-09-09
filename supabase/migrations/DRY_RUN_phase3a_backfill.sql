-- ══════════════════════════════════════════════════════════════
-- DRY RUN — Phase 3a Backfill WVSU as Customer #1
-- ══════════════════════════════════════════════════════════════
--
-- HOW TO USE:
--   1. Open the Supabase SQL Editor for project fweqqpgxfpaifmkrnmsx
--   2. Paste this ENTIRE file into the editor
--   3. Click "Run"
--   4. Check the RAISE NOTICE output — it will show what would be created
--   5. The ROLLBACK at the end ensures NO changes are persisted
--   6. Review the output, then run the real backfill (Stage 3)
--
-- WHAT THIS DOES:
--   Wraps the corrected backfill script in BEGIN/ROLLBACK so you can
--   see exactly what it would do without committing anything.
--   The EMU label scheme uses EMU-001, EMU-002, etc. — independent
--   of device/controller naming.
--
-- ══════════════════════════════════════════════════════════════

BEGIN;

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
  v_emu_counter    INTEGER;
  v_phase_mode     TEXT := 'THREE_PHASE';
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
  -- Initialize EMU counter from existing labels (EMU-NNN pattern)
  SELECT COALESCE(MAX(CAST(SUBSTRING(label FROM 'EMU-(\d+)') AS INTEGER)), 0)
    INTO v_emu_counter
    FROM emus
    WHERE label ~ '^EMU-\d+$';

  FOR v_device IN SELECT id, name, api_key_hash, created_at FROM devices ORDER BY created_at LOOP
    -- Check if this device was already backfilled (controller exists)
    SELECT id INTO v_controller_id
    FROM controllers
    WHERE legacy_device_id = v_device.id
    LIMIT 1;

    IF v_controller_id IS NOT NULL THEN
      -- Already backfilled — read emu_id from existing controller, skip creation
      SELECT emu_id INTO v_emu_id
      FROM controllers
      WHERE id = v_controller_id;

      RAISE NOTICE '    Device % already backfilled (controller %, EMU %)', v_device.id, v_controller_id, v_emu_id;
    ELSE
      -- Not yet backfilled — create EMU + controller + installation
      v_emu_counter := v_emu_counter + 1;

      INSERT INTO emus (label, owner_type, owner_customer_id, status)
      VALUES ('EMU-' || LPAD(v_emu_counter::text, 3, '0'), 'CUSTOMER', v_customer_id, 'ACTIVE')
      RETURNING id INTO v_emu_id;
      RAISE NOTICE '    Created EMU: EMU-% (%)', LPAD(v_emu_counter::text, 3, '0'), v_emu_id;

      -- Controller (SHA-256 of api_key_hash, with legacy bridge)
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

      -- Installation (EMU placed in CICT Building)
      INSERT INTO emu_installations (emu_id, customer_id, site_id, building_id, started_at)
      VALUES (v_emu_id, v_customer_id, v_site_id, v_building_id, v_device.created_at)
      RETURNING id INTO v_installation_id;
      RAISE NOTICE '    Created installation: %', v_installation_id;

      -- EMU Configuration (phase mode)
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

ROLLBACK;

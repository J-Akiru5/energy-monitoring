-- ══════════════════════════════════════════════════════════════
-- Backfill telemetry tenant stamps
-- Energy Monitoring System
--
-- Follow-up to the RM-03 finding: alerts, relay_logs, blackout_events,
-- device_alert_state and (a few) power_readings rows created after the
-- Phase 3a backfill were never stamped with customer_id/emu_id by their
-- write paths. Unstamped rows are invisible to every non-service-role
-- caller under RLS (fail-closed) and to customer-scoped read paths —
-- e.g. getUnreadAlerts() and getRelayLogs() both filter on customer_id.
--
-- The write paths are fixed in the application layer (createAlert,
-- logRelayAction, startBlackoutEvent, startAlertIncident now resolve the
-- tenant stamp via lookupControllerByDevice). This migration repairs the
-- rows that were written before that fix.
--
-- Idempotent: only rows with customer_id IS NULL are touched. Device →
-- customer/EMU resolution uses the device's ACTIVE controller bridge —
-- the same path the application and the RLS policies use. Rows whose
-- device has no ACTIVE controller stay NULL (fail-closed).
-- ══════════════════════════════════════════════════════════════

-- ──── alerts ─────────────────────────────────────────────────
UPDATE alerts a
SET customer_id = e.owner_customer_id,
    emu_id      = e.id
FROM controllers c
JOIN emus e ON e.id = c.emu_id
WHERE c.legacy_device_id = a.device_id
  AND c.status = 'ACTIVE'
  AND a.customer_id IS NULL;

-- ──── relay_logs ─────────────────────────────────────────────
UPDATE relay_logs r
SET customer_id = e.owner_customer_id,
    emu_id      = e.id
FROM controllers c
JOIN emus e ON e.id = c.emu_id
WHERE c.legacy_device_id = r.device_id
  AND c.status = 'ACTIVE'
  AND r.customer_id IS NULL;

-- ──── blackout_events ────────────────────────────────────────
UPDATE blackout_events b
SET customer_id = e.owner_customer_id,
    emu_id      = e.id
FROM controllers c
JOIN emus e ON e.id = c.emu_id
WHERE c.legacy_device_id = b.device_id
  AND c.status = 'ACTIVE'
  AND b.customer_id IS NULL;

-- ──── device_alert_state ─────────────────────────────────────
UPDATE device_alert_state s
SET customer_id = e.owner_customer_id,
    emu_id      = e.id
FROM controllers c
JOIN emus e ON e.id = c.emu_id
WHERE c.legacy_device_id = s.device_id
  AND c.status = 'ACTIVE'
  AND s.customer_id IS NULL;

-- ──── power_readings ─────────────────────────────────────────
-- customer_id + emu_id only. installation_id / controller_id /
-- phase_config are deliberately left NULL for these rows: the
-- recording-time installation is not knowable for historical rows, and
-- stamping the current one would be false. The device → customer/EMU
-- bridge is stable and sufficient for scoping and retention.
UPDATE power_readings p
SET customer_id = e.owner_customer_id,
    emu_id      = e.id
FROM controllers c
JOIN emus e ON e.id = c.emu_id
WHERE c.legacy_device_id = p.device_id
  AND c.status = 'ACTIVE'
  AND p.customer_id IS NULL;

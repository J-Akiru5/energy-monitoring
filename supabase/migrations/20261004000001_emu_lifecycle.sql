-- ══════════════════════════════════════════════════════════════
-- EMU lifecycle — transactional decommission / redeploy (RM-07)
-- Energy Monitoring System
--
-- The schema's EMU lifecycle is ACTIVE | DECOMMISSIONED (see
-- 20260910120000_phase3a_tenant_schema.sql:67). The longer chain in the
-- roadmap (INVENTORY → PROVISIONED → ASSIGNED → INSTALLED → ACTIVE →
-- DECOMMISSIONED) has no schema representation and is not modeled here;
-- this migration makes the two real states operational:
--
--   decommission_emu(device_id):
--     - ends the EMU's open installation (ended_at = now())
--     - emus.status → 'DECOMMISSIONED'
--
--   redeploy_emu(device_id, site_id, building_id):
--     - only valid for a DECOMMISSIONED EMU
--     - target site/building must belong to the EMU's owning customer —
--       cross-customer redeployment is a reassignment (RM-09, blocked on
--       OD-1) and is deliberately rejected here
--     - inserts a new installation, emus.status → 'ACTIVE'
--
-- Both are single transactions with row locks, so a mid-failure cannot
-- leave a decommissioned EMU with an open installation, or an ACTIVE EMU
-- with none. Neither touches controllers: the hardware credential stays
-- valid so a physically redeployed unit can resume telemetry.
--
-- Access: service_role only — anon/authenticated JWTs cannot execute.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.decommission_emu(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_emu_id          uuid;
  v_status          text;
  v_installation_id uuid;
BEGIN
  -- Resolve + lock the ACTIVE controller bridging this device.
  SELECT c.emu_id INTO v_emu_id
  FROM controllers c
  WHERE c.legacy_device_id = p_device_id
    AND c.status = 'ACTIVE'
  FOR UPDATE;

  IF v_emu_id IS NULL THEN
    RAISE EXCEPTION 'decommission_emu: no ACTIVE controller for device %', p_device_id;
  END IF;

  SELECT status INTO v_status
  FROM emus
  WHERE id = v_emu_id
  FOR UPDATE;

  IF v_status = 'DECOMMISSIONED' THEN
    RAISE EXCEPTION 'decommission_emu: EMU is already decommissioned';
  END IF;

  SELECT id INTO v_installation_id
  FROM emu_installations
  WHERE emu_id = v_emu_id
    AND ended_at IS NULL
  FOR UPDATE;

  IF v_installation_id IS NULL THEN
    RAISE EXCEPTION 'decommission_emu: EMU has no active installation';
  END IF;

  UPDATE emu_installations
  SET ended_at = now()
  WHERE id = v_installation_id;

  UPDATE emus
  SET status = 'DECOMMISSIONED', updated_at = now()
  WHERE id = v_emu_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeploy_emu(
  p_device_id uuid,
  p_site_id uuid,
  p_building_id uuid
)
RETURNS TABLE (installation_id uuid, emu_id uuid, customer_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_emu_id           uuid;
  v_status           text;
  v_customer_id      uuid;
  v_site_customer    uuid;
  v_building_site    uuid;
  v_new_installation uuid;
BEGIN
  SELECT c.emu_id INTO v_emu_id
  FROM controllers c
  WHERE c.legacy_device_id = p_device_id
    AND c.status = 'ACTIVE'
  FOR UPDATE;

  IF v_emu_id IS NULL THEN
    RAISE EXCEPTION 'redeploy_emu: no ACTIVE controller for device %', p_device_id;
  END IF;

  SELECT status, owner_customer_id INTO v_status, v_customer_id
  FROM emus
  WHERE id = v_emu_id
  FOR UPDATE;

  IF v_status <> 'DECOMMISSIONED' THEN
    RAISE EXCEPTION 'redeploy_emu: EMU is not decommissioned (status %)', v_status;
  END IF;

  -- Target must be within the EMU's owning customer. Cross-customer
  -- redeployment is RM-09 territory (blocked on OD-1) — reject, don't guess.
  SELECT customer_id INTO v_site_customer FROM sites WHERE id = p_site_id;
  IF v_site_customer IS NULL THEN
    RAISE EXCEPTION 'redeploy_emu: target site not found';
  END IF;
  IF v_site_customer <> v_customer_id THEN
    RAISE EXCEPTION 'redeploy_emu: target site belongs to a different customer';
  END IF;

  SELECT site_id INTO v_building_site FROM buildings WHERE id = p_building_id;
  IF v_building_site IS NULL THEN
    RAISE EXCEPTION 'redeploy_emu: target building not found';
  END IF;
  IF v_building_site <> p_site_id THEN
    RAISE EXCEPTION 'redeploy_emu: target building does not belong to the target site';
  END IF;

  IF EXISTS (
    SELECT 1 FROM emu_installations
    WHERE emu_id = v_emu_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'redeploy_emu: EMU already has an active installation';
  END IF;

  INSERT INTO emu_installations (emu_id, customer_id, site_id, building_id)
  VALUES (v_emu_id, v_customer_id, p_site_id, p_building_id)
  RETURNING id INTO v_new_installation;

  UPDATE emus
  SET status = 'ACTIVE', updated_at = now()
  WHERE id = v_emu_id;

  RETURN QUERY SELECT v_new_installation, v_emu_id, v_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.decommission_emu(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decommission_emu(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.decommission_emu(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.decommission_emu(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) TO service_role;

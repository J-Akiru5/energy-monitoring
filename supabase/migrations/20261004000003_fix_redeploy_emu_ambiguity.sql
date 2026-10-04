-- ══════════════════════════════════════════════════════════════
-- Fix: redeploy_emu() ambiguous column reference (RM-07 follow-up)
-- Energy Monitoring System
--
-- Found by the live lifecycle test immediately after the original
-- migration was applied: the function declares
--   RETURNS TABLE (installation_id uuid, emu_id uuid, customer_id uuid)
-- so the OUT parameter `customer_id` collides with sites.customer_id
-- in the unqualified target lookups, raising:
--   'column reference "customer_id" is ambiguous'
-- The valid redeploy path and both target-validation paths failed.
--
-- Fix: qualify the columns in the two target lookups (s.customer_id,
-- b.site_id). No other behavior changes — the transaction, locks, and
-- same-customer constraint are identical to 20261004000001.
-- ══════════════════════════════════════════════════════════════

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
  -- Columns are qualified: the OUT parameter customer_id would otherwise
  -- make the bare reference ambiguous.
  SELECT s.customer_id INTO v_site_customer FROM sites s WHERE s.id = p_site_id;
  IF v_site_customer IS NULL THEN
    RAISE EXCEPTION 'redeploy_emu: target site not found';
  END IF;
  IF v_site_customer <> v_customer_id THEN
    RAISE EXCEPTION 'redeploy_emu: target site belongs to a different customer';
  END IF;

  SELECT b.site_id INTO v_building_site FROM buildings b WHERE b.id = p_building_id;
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

REVOKE ALL ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeploy_emu(uuid, uuid, uuid) TO service_role;

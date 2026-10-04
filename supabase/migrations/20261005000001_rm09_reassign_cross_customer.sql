-- ══════════════════════════════════════════════════════════════
-- RM-09 — Operational vs commercial reassignment split
-- Energy Monitoring System
--
-- Decision #2: operational reassignment (within the EMU's current
-- tenancy) is a customer-scoped operation; cross-customer reassignment
-- is commercial and Super Admin only. Resolved with Jeff 2026-10-05:
--
--   * The authority split is by SCOPE (within vs across customers).
--     ownership_party (RM-08) does NOT change the classification —
--     a PROVIDER-owned unit moved within its customer's tenancy is
--     still an operational reassignment.
--   * Operational path: redeploy_emu() — unchanged behavior, same
--     customer only. The API route now gates it behind the dedicated
--     "reassign_emu" permission (was manage_devices).
--   * Commercial path: reassign_emu_cross_customer() — NEW. Moves a
--     DECOMMISSIONED EMU into a different customer's tenancy in one
--     transaction: new installation under the target customer, then
--     emus.owner_customer_id updated. ownership_party is carried
--     unchanged — it describes the hardware, not the tenancy.
--
-- Historical telemetry keeps its original customer_id stamps (ADR-05);
-- only future readings stamp the new customer (tenant.ts resolves the
-- customer through controllers → emus.owner_customer_id).
--
-- OUT-parameter discipline (see 20261004000003 / ...0004): RETURNS TABLE
-- declares installation_id, emu_id and customer_id, so every SQL
-- reference to a column of the same name MUST be qualified or the
-- function raises 'column reference "..." is ambiguous' at runtime.
-- Both functions below qualify them.
--
-- Access: service_role only — authorization (Super Admin for the
-- cross-customer path) is enforced at the API route layer; these
-- functions enforce the data invariants.
-- ══════════════════════════════════════════════════════════════

-- ──── redeploy_emu — same behavior, comment updated ─────────────
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
  -- reassignment goes through reassign_emu_cross_customer() (RM-09).
  -- Columns qualified: the OUT parameter customer_id would otherwise
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

  -- Qualified: the OUT parameter emu_id would otherwise make this ambiguous.
  IF EXISTS (
    SELECT 1 FROM emu_installations i
    WHERE i.emu_id = v_emu_id AND i.ended_at IS NULL
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

-- ──── reassign_emu_cross_customer — commercial reassignment ─────
CREATE OR REPLACE FUNCTION public.reassign_emu_cross_customer(
  p_device_id uuid,
  p_target_customer_id uuid,
  p_site_id uuid,
  p_building_id uuid
)
RETURNS TABLE (installation_id uuid, emu_id uuid, customer_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_emu_id            uuid;
  v_status            text;
  v_current_customer  uuid;
  v_site_customer     uuid;
  v_building_site     uuid;
  v_new_installation  uuid;
BEGIN
  SELECT c.emu_id INTO v_emu_id
  FROM controllers c
  WHERE c.legacy_device_id = p_device_id
    AND c.status = 'ACTIVE'
  FOR UPDATE;

  IF v_emu_id IS NULL THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: no ACTIVE controller for device %', p_device_id;
  END IF;

  SELECT status, owner_customer_id INTO v_status, v_current_customer
  FROM emus
  WHERE id = v_emu_id
  FOR UPDATE;

  IF v_status <> 'DECOMMISSIONED' THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: EMU is not decommissioned (status %)', v_status;
  END IF;

  IF p_target_customer_id = v_current_customer THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: target customer is the EMU''s current customer — use redeploy_emu';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = p_target_customer_id) THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: target customer not found';
  END IF;

  -- Columns qualified: the OUT parameter customer_id would otherwise
  -- make the bare reference ambiguous.
  SELECT s.customer_id INTO v_site_customer FROM sites s WHERE s.id = p_site_id;
  IF v_site_customer IS NULL THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: target site not found';
  END IF;
  IF v_site_customer <> p_target_customer_id THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: target site does not belong to the target customer';
  END IF;

  SELECT b.site_id INTO v_building_site FROM buildings b WHERE b.id = p_building_id;
  IF v_building_site IS NULL THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: target building not found';
  END IF;
  IF v_building_site <> p_site_id THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: target building does not belong to the target site';
  END IF;

  -- Qualified: the OUT parameter emu_id would otherwise make this ambiguous.
  IF EXISTS (
    SELECT 1 FROM emu_installations i
    WHERE i.emu_id = v_emu_id AND i.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'reassign_emu_cross_customer: EMU already has an active installation';
  END IF;

  INSERT INTO emu_installations (emu_id, customer_id, site_id, building_id)
  VALUES (v_emu_id, p_target_customer_id, p_site_id, p_building_id)
  RETURNING id INTO v_new_installation;

  -- Tenancy moves; ownership_party is deliberately untouched.
  UPDATE emus
  SET owner_customer_id = p_target_customer_id,
      status = 'ACTIVE',
      updated_at = now()
  WHERE id = v_emu_id;

  RETURN QUERY SELECT v_new_installation, v_emu_id, p_target_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_emu_cross_customer(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_emu_cross_customer(uuid, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reassign_emu_cross_customer(uuid, uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_emu_cross_customer(uuid, uuid, uuid, uuid) TO service_role;

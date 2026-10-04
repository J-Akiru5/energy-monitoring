-- ══════════════════════════════════════════════════════════════
-- Controller replacement — transactional revoke-then-issue (RM-02)
-- Energy Monitoring System
--
-- Atomically replaces the ACTIVE controller bridging a legacy device:
--   - every ACTIVE controller on the device's EMU → 'REPLACED',
--     retired_at = now()
--   - devices.api_key_hash rotated to the new raw token (keeps the
--     legacy column consistent for tooling that derives from it)
--   - new controller inserted ACTIVE, bridged to the same device
--
-- Invariants, enforced by the single transaction + row locks:
--   - after success: exactly one ACTIVE controller for the EMU
--   - after any failure: the pre-call state is fully preserved —
--     never two ACTIVE controllers, never zero
--
-- Status semantics: 'REPLACED' = superseded by a new controller (this
-- flow). 'REVOKED' is reserved for disabling a controller with no
-- replacement and is not set by this function.
--
-- Auth impact: device auth accepts only ACTIVE controllers, so the old
-- token stops authenticating the moment this commits; the new raw token
-- is the only working credential. Rotating devices.api_key_hash also
-- invalidates the old token on any code path still reading that column.
--
-- Access: service_role only — anon/authenticated JWTs cannot execute.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.replace_controller(
  p_device_id uuid,
  p_new_token text
)
RETURNS TABLE (controller_id uuid, device_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_emu_id     uuid;
  v_new_id     uuid;
  v_active_ids uuid[];
BEGIN
  IF p_new_token IS NULL OR length(p_new_token) < 16 THEN
    RAISE EXCEPTION 'replace_controller: new token missing or too short';
  END IF;

  -- Locate + lock the ACTIVE controller bridging this device. FOR UPDATE
  -- serializes concurrent replacements for the same device: the second
  -- caller re-reads after the first commits and finds no ACTIVE row.
  SELECT c.emu_id INTO v_emu_id
  FROM controllers c
  WHERE c.legacy_device_id = p_device_id
    AND c.status = 'ACTIVE'
  FOR UPDATE;

  IF v_emu_id IS NULL THEN
    RAISE EXCEPTION 'replace_controller: no ACTIVE controller for device %', p_device_id;
  END IF;

  -- Lock the EMU so replacements arriving through a different bridge
  -- cannot interleave either.
  PERFORM 1 FROM emus WHERE id = v_emu_id FOR UPDATE;

  -- Retire every ACTIVE controller on this EMU. Defensive: guarantees at
  -- most one ACTIVE controller survives even from a bad prior state.
  SELECT array_agg(c.id) INTO v_active_ids
  FROM controllers c
  WHERE c.emu_id = v_emu_id AND c.status = 'ACTIVE';

  UPDATE controllers
  SET status = 'REPLACED', retired_at = now(), updated_at = now()
  WHERE id = ANY (v_active_ids);

  UPDATE devices SET api_key_hash = p_new_token WHERE id = p_device_id;

  INSERT INTO controllers (emu_id, token_hash, legacy_device_id, status)
  VALUES (
    v_emu_id,
    encode(sha256(convert_to(p_new_token, 'UTF8')), 'hex'),
    p_device_id,
    'ACTIVE'
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, p_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_controller(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_controller(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.replace_controller(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_controller(uuid, text) TO service_role;

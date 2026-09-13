-- Enable relay_state for Supabase Realtime postgres_changes.
--
-- The ESP32 subscribes to relay_state changes over Supabase Realtime
-- (topic: realtime:public:relay_state:device_id=eq.<deviceId>, anon key).
-- relay_state was never added to the supabase_realtime publication, so the
-- server rejected the subscription with:
--   "Unable to subscribe to changes with given parameters. Please check
--    Realtime is enabled for the given connect parameters"
-- while the join itself (phx_reply) succeeded. Result: dashboard Trip/Reset
-- updated the DB but the ESP32 never received the event, so the relay never
-- actuated.
--
-- This migration adds the table to the publication. It is deliberately
-- idempotent and a no-op on databases where relay_state does not exist
-- (the table predates the tracked migrations and is not created by them).
--
-- No schema, data, RLS, or grants are changed. RLS on relay_state remains
-- as-is (currently disabled; hardening is tracked separately and must be
-- coordinated with the ESP32 Realtime subscription).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'relay_state'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'relay_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.relay_state;
    RAISE NOTICE 'relay_state added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'relay_state already published (or missing) — no change';
  END IF;
END $$;

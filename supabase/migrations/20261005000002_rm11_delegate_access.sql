-- ══════════════════════════════════════════════════════════════
-- RM-11 — external-delegate control_relay safeguards (decision #4)
-- Energy Monitoring System
--
-- Decision #4 names the safeguards for granting control_relay to an
-- external delegate: explicit authorization, limited scope, limited
-- duration, audit logging, actor identification. Resolved with Jeff
-- 2026-10-05: build on the foundations the phase-3a schema already
-- anticipated rather than inventing a parallel mechanism.
--
-- Already in schema (unused until now):
--   memberships.is_external   — contractor / external auditor marker
--   membership_scopes         — scope rows, scope_type in
--                               'customer' | 'site' | 'building' | 'emu';
--                               absence of scope rows = customer-wide
--                               access (roles.ts convention)
--
-- What was missing: duration. This migration adds expires_at to
-- membership_permissions — a granted permission fails closed once past
-- its expiry (resolveAccess filters it out). NULL = no expiry, so every
-- existing grant is unaffected.
--
-- Enforcement lives in the auth layer (packages/auth):
--   - resolveAccess() excludes expired grants (fail closed on invalid
--     dates too) and returns membership scopes on ResolvedAccess
--   - assertDeviceInScopes() checks relay targets against the scopes
--     on the control_relay routes (relay commands + relay config)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE membership_permissions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN membership_permissions.expires_at IS
  'NULL = no expiry. Non-NULL = the grant is valid until this instant, then fails closed (RM-11 / decision #4 delegate time-boxing).';

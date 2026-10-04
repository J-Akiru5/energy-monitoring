-- ══════════════════════════════════════════════════════════════
-- RM-08 — Provider-vs-customer ownership on EMUs (OD-1, additive)
-- Energy Monitoring System
--
-- emus.owner_type ('CUSTOMER' | 'SITE' | 'BUILDING') expresses which
-- level of the org tree an assignment targets — assignment granularity,
-- not who owns the physical hardware. Decisions #1–#3 require that
-- second fact; OD-1 (2026-10-05) resolved to an ADDITIVE column, so
-- owner_type keeps its existing meaning untouched (nothing in the app
-- reads it as ownership today).
--
-- ownership_party:
--   'CUSTOMER' — customer-owned unit
--   'PROVIDER' — Syntaxure-owned unit (governs RM-09's reassignment
--                split and RM-10's retention policy)
--
-- SAFETY: nullable ADD COLUMN IF NOT EXISTS → explicit backfill →
-- DEFAULT + NOT NULL, so the column is added without a table rewrite
-- and existing rows are provably populated before the constraint lands.
-- Every existing EMU is CUSTOMER-owned: the WVSU pilot and all test
-- fixtures were provisioned for their customer.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE emus ADD COLUMN IF NOT EXISTS ownership_party TEXT;

-- Backfill: every row that predates this migration is customer-owned.
UPDATE emus SET ownership_party = 'CUSTOMER' WHERE ownership_party IS NULL;

ALTER TABLE emus ALTER COLUMN ownership_party SET DEFAULT 'CUSTOMER';
ALTER TABLE emus ALTER COLUMN ownership_party SET NOT NULL;

COMMENT ON COLUMN emus.ownership_party IS
  'Who owns the physical unit: ''PROVIDER'' (Syntaxure) or ''CUSTOMER''. Orthogonal to owner_type (which is assignment granularity). Decision OD-1 / RM-08.';

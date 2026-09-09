-- ══════════════════════════════════════════════════════════════
-- PHASE 3a — Tenant Schema: 10 new tables
-- Energy Monitoring System
--
-- Creates the customer/site/building hierarchy, EMU entities,
-- controller tokens, and membership tables for multi-tenant
-- isolation.
--
-- SAFETY: All tables are new. No existing tables are modified.
-- All CREATE statements use IF NOT EXISTS for idempotency.
-- ══════════════════════════════════════════════════════════════

-- ──── Customers (top-level tenant) ──────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES customers(id),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'ORGANIZATION',
  --   'ORGANIZATION' | 'DEPARTMENT' | 'INDIVIDUAL'
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  --   'ACTIVE' | 'SUSPENDED' | 'DELETED'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delete_after  TIMESTAMPTZ
  --   Soft-delete timestamp. NULL = never delete.
);

CREATE INDEX IF NOT EXISTS idx_customers_parent
  ON customers (parent_id);

-- ──── Sites (campus / location group) ──────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_customer
  ON sites (customer_id);

-- ──── Buildings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buildings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id),
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buildings_site
  ON buildings (site_id);

-- ──── EMUs (Energy Monitoring Units) ────────────────────────
-- Replaces the implicit "device = EMU" concept. One EMU may
-- have multiple controllers over its lifetime (token rotation,
-- hardware replacement).
CREATE TABLE IF NOT EXISTS emus (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label               TEXT NOT NULL,
  --   Human-readable label (typically reuses devices.name)
  owner_type          TEXT NOT NULL DEFAULT 'CUSTOMER',
  --   'CUSTOMER' | 'SITE' | 'BUILDING'
  owner_customer_id   UUID NOT NULL REFERENCES customers(id),
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  --   'ACTIVE' | 'DECOMMISSIONED'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emus_owner
  ON emus (owner_customer_id);

-- ──── EMU Installations (where an EMU is physically placed) ─
CREATE TABLE IF NOT EXISTS emu_installations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emu_id        UUID NOT NULL REFERENCES emus(id),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  site_id       UUID NOT NULL REFERENCES sites(id),
  building_id   UUID NOT NULL REFERENCES buildings(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  --   NULL = currently installed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emu_installations_emu
  ON emu_installations (emu_id);

CREATE INDEX IF NOT EXISTS idx_emu_installations_building
  ON emu_installations (building_id);

-- ──── EMU Configurations (phase mode over time) ─────────────
CREATE TABLE IF NOT EXISTS emu_configurations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emu_id        UUID NOT NULL REFERENCES emus(id),
  phase_mode    TEXT NOT NULL DEFAULT 'THREE_PHASE',
  --   'SINGLE_PHASE' | 'THREE_PHASE'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  --   NULL = current configuration
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emu_configurations_emu
  ON emu_configurations (emu_id);

-- ──── Controllers (ESP32 hardware, token-hashed) ────────────
-- Each controller has a unique token_hash. When a device is
-- replaced, the old controller is retired and a new one created.
-- legacy_device_id bridges to the existing devices table.
CREATE TABLE IF NOT EXISTS controllers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emu_id            UUID NOT NULL REFERENCES emus(id),
  token_hash        TEXT NOT NULL UNIQUE,
  --   SHA-256 of the raw token, hex-encoded
  legacy_device_id  UUID REFERENCES devices(id),
  --   Bridge to existing devices table during Phase 3a
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  --   'ACTIVE' | 'REVOKED' | 'REPLACED'
  provisioned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_controllers_emu
  ON controllers (emu_id);

CREATE INDEX IF NOT EXISTS idx_controllers_legacy_device
  ON controllers (legacy_device_id);

-- ──── Memberships (user ↔ customer binding) ─────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  --   References auth.users(id) — Supabase Auth
  customer_id   UUID NOT NULL REFERENCES customers(id),
  role          TEXT NOT NULL DEFAULT 'VIEWER',
  --   'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
  is_external   BOOLEAN NOT NULL DEFAULT false,
  --   true = contractor / external auditor
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_customer
  ON memberships (customer_id);

CREATE INDEX IF NOT EXISTS idx_memberships_user
  ON memberships (user_id);

-- ──── Membership Permissions (granular grants) ──────────────
CREATE TABLE IF NOT EXISTS membership_permissions (
  membership_id   UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  permission      TEXT NOT NULL,
  --   'read:telemetry' | 'write:relay' | 'manage:devices' | etc.
  granted         BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (membership_id, permission)
);

-- ──── Membership Scopes (what a membership can see) ─────────
CREATE TABLE IF NOT EXISTS membership_scopes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id   UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  scope_type      TEXT NOT NULL,
  --   'customer' | 'site' | 'building' | 'emu'
  scope_id        UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (membership_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_scopes_membership
  ON membership_scopes (membership_id);

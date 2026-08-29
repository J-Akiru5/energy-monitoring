# PDF Generation Bug Report

**Date:** 2026-04-27  
**Component:** `/api/reports/pdf` and `/api/reports/summary`  
**Status:** Fixed

---

## Summary

PDF generation (and the underlying JSON summary endpoint) failed at runtime due to two independent bugs:

1. **`getBillingRate` crashed with `PGRST116`** when the `billing_config` table was empty — blocking every PDF request.
2. **`schema.sql` was out of sync** with migration `002_alert_incidents.sql`, so fresh database installations were missing the `ended_at` column on `alerts` and the entire `device_alert_state` table — causing failures when the `alertOnly=true` filter was used.

---

## Root Causes

### Bug 1 — `getBillingRate` throws on empty `billing_config` table

**File:** `packages/database/src/queries/billing.ts`

The function queried `billing_config` using Supabase's `.single()`, which returns a `PGRST116` error ("no rows returned") when the table is empty. Because the function treated every error — including `PGRST116` — as a hard throw, any request that hit an empty billing table would propagate an uncaught exception all the way up to the PDF route and return HTTP 500.

While the `schema.sql` seeds a default rate row, the seed is skipped on `ON CONFLICT DO NOTHING`, meaning a truncated or manually cleared table causes a total outage for the reports feature.

**Evidence in `_lib.ts`:**

```ts
// Caller already anticipates a nullable result — optional chaining and fallback are used.
const rateConfig = await getBillingRate();
const ratePhpPerKwh = Number(rateConfig?.rate_php_per_kwh ?? 10);
```

The `?.` and `?? 10` in the caller clearly expect `rateConfig` to be `null`-able, but `getBillingRate` could never return `null` — it only threw or returned a row.

---

### Bug 2 — `schema.sql` missing alert incident columns and `device_alert_state` table

**File:** `packages/database/src/schema.sql`

Migration `002_alert_incidents.sql` added four columns to the `alerts` table and created the `device_alert_state` table. These additions were never back-ported into `schema.sql`, which is the authoritative file used to bootstrap a fresh Supabase database.

Missing items in `schema.sql` after migration 002:

| Object | Missing element |
|--------|-----------------|
| `alerts` table | `phase TEXT` |
| `alerts` table | `is_incident BOOLEAN NOT NULL DEFAULT false` |
| `alerts` table | `ended_at TIMESTAMPTZ` |
| `alerts` table | `duration_seconds INTEGER` |
| (new table) | `device_alert_state` (entire table + index) |

**Impact:** Any fresh installation set up with `schema.sql` (as documented) would not have the `ended_at` column. When `alertOnly=true` is passed to the report endpoint, `_lib.ts` runs:

```ts
const { data: alerts, error: alertsError } = await supabase
  .from("alerts")
  .select("created_at, ended_at")           // ← column does not exist
  .or(`ended_at.gte.${filters.fromIso},ended_at.is.null`)  // ← PostgREST filter also fails
  ...
```

Supabase/PostgREST returns a column-not-found error, which is thrown and surfaces as HTTP 500.

---

## Fixes Applied

### Fix 1 — Use `maybeSingle()` in `getBillingRate`

**File:** `packages/database/src/queries/billing.ts`

Changed `.single()` → `.maybeSingle()`. Unlike `.single()`, `maybeSingle()` returns `null` (not an error) when the query matches zero rows. The caller already handles `null` via `rateConfig?.rate_php_per_kwh ?? 10`, so no other change is needed.

```diff
- .single();
+ .maybeSingle();
+
+ // maybeSingle() returns null (not an error) when no rows exist, so PGRST116
+ // ("no rows") is handled gracefully and a default rate is used by the caller.
  if (error) throw new Error(`Fetch billing rate failed: ${error.message}`);
```

### Fix 2 — Sync `schema.sql` with migration 002

**File:** `packages/database/src/schema.sql`

- Added `phase`, `is_incident`, `ended_at`, and `duration_seconds` columns to the `alerts` table definition.
- Added the full `device_alert_state` table (with its unique constraint and index) between the relay section and the blackout-events section, matching the structure in `002_alert_incidents.sql`.

Fresh installations using `schema.sql` now produce a database identical to running the baseline schema plus all migrations.

---

## How to Verify

1. **Empty billing table path:**
   - Truncate `billing_config`.
   - Call `GET /api/reports/pdf?deviceId=<id>` (or the summary endpoint).
   - Expected before fix: HTTP 500 (`Fetch billing rate failed: ...`).
   - Expected after fix: PDF generated using the default 10 PHP/kWh rate.

2. **`alertOnly=true` path on a fresh schema install:**
   - Bootstrap a new Supabase project using `packages/database/src/schema.sql`.
   - Call `GET /api/reports/pdf?deviceId=<id>&alertOnly=true`.
   - Expected before fix: HTTP 500 (column `ended_at` does not exist).
   - Expected after fix: HTTP 200 with a valid PDF.

---

## Affected Endpoints

| Endpoint | Affected |
|----------|----------|
| `GET /api/reports/pdf` | Yes — both bugs |
| `GET /api/reports/summary` | Yes — both bugs (shares `buildConsumptionSummary`) |

---

## Migration Notes

**Existing installations** (database already running with migration 002 applied) are **not affected** by Fix 2 — the schema change is purely additive to `schema.sql` and does not alter any existing table.

**Fix 1** (`maybeSingle`) is fully backward-compatible: the change in return behaviour only activates when zero rows are present, which is an error state in the original code as well.

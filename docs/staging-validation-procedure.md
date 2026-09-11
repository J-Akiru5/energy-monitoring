# Staging Validation Procedure

**Date:** 2026-09-11
**Pipeline:** `develop` → `staging` → `main`
**Goal:** Get a stable candidate onto staging for real browser and API verification before production promotion.

---

## 1. Repository Architecture

### Three Vercel Apps

| App | Package Name | Vercel Project | Dev Port | Role |
|-----|-------------|----------------|----------|------|
| **web** | `web` | energy-monitoring-web | 3000 | Primary app: dashboard, telemetry, relay control, device ingest |
| **admin** | `@energy/admin` | energy-monitoring-admin | 3001 | Admin portal: relay proxy, device management, billing |
| **super-admin** | `@energy/super-admin` | energy-monitoring-super-admin | 3002 | Platform super-admin console (minimal) |

### Deployment Gating

All three apps use `scripts/vercel-ignore.sh` which only allows builds on three branches:

```
main     → Production
staging  → Staging / preview
develop  → Integration
```

All other branches are skipped. Within allowed branches, `turbo-ignore` further filters by checking if the app's files changed.

### Build System

- **Monorepo manager:** pnpm 9.1.0 workspaces
- **Build orchestrator:** Turborepo (`turbo build`)
- **Framework:** Next.js 16.1.6 (Turbopack)
- **Root build:** `pnpm build` runs `turbo build` across all apps

---

## 2. Environment Variables

### Shared (all three apps)

| Variable | Source | Notes |
|----------|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings | `https://fweqqpgxfpaifmkrnmsx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings | **Secret** — server-side only |
| `DATABASE_URL` | Supabase dashboard → Settings → Database | Connection pooler URL |

### Web App Only

| Variable | Source | Notes |
|----------|--------|-------|
| `RELAY_ADMIN_SECRET` | Generate a random string | **Must match admin app's value exactly** |
| `DEVICE_API_KEY` | Device provisioning | For ESP32 auth (value lives in Vercel env — not committed; see Jeff if rotation needed) |
| `DEFAULT_RATE_PHP_PER_KWH` | Billing config | `10.00` |

### Admin App Only

| Variable | Source | Notes |
|----------|--------|-------|
| `RELAY_ADMIN_SECRET` | Same value as web app | **Critical: must match web app** |
| `WEB_RELAY_URL` | Construct from web staging URL | Defaults to `https://energy-monitoring-web.vercel.app/api/relay` — **must override for staging** |

### Super-Admin App

| Variable | Source | Notes |
|----------|--------|-------|
| (same shared vars) | — | No app-specific vars beyond the shared set |

### Staging-Specific Overrides

For staging, the admin app needs:

```
WEB_RELAY_URL=https://energy-monitoring-web-<staging-suffix>.vercel.app/api/relay
```

The exact staging URL depends on Vercel's preview deployment naming. Check the Vercel dashboard after the first staging deploy to get the correct URL.

---

## 3. Supabase Configuration

### Project: `fweqqpgxfpaifmkrnmsx`

- **Region:** AWS ap-southeast-1
- **URL:** `https://fweqqpgxfpaifmkrnmsx.supabase.co`

### Required Tables (verified in production)

- `auth.users` — Supabase Auth managed table
- `customers` — Tenant organizations
- `memberships` — User ↔ customer bindings with roles
- `membership_permissions` — Granular permission grants per membership
- `super_admins` — Platform super-admin bypass table
- `devices` — Registered ESP32 devices
- `controllers` — Controller tokens bridging devices to EMUs
- `emus` — Energy Monitoring Units
- `power_readings` — Telemetry data (append-only)
- `alerts`, `relay_config`, `relay_state`, `relay_logs` — Alerting and relay state
- `billing_config`, `alert_thresholds` — System configuration

### Required Auth Config

- **Email/password sign-in** must be enabled in Supabase Auth settings
- **Session duration:** Default (1 hour) — no custom configuration found

### Seed Data (if starting fresh)

- Run `scripts/onboard-wvsu-admin.ts` to create WVSU's OWNER membership
- Run `scripts/bootstrap-super-admin.ts` to create the first super-admin user
- Run `scripts/create-rls-test-fixtures.ts` for test data (optional)

---

## 4. Build Commands

### Full Monorepo Build

```bash
pnpm install
pnpm build
```

### Individual App Builds

```bash
# Web
cd apps/web && pnpm build

# Admin
cd apps/admin && pnpm build

# Super-admin
cd apps/super-admin && pnpm build
```

### Type Checking

```bash
pnpm type-check
```

### Linting

```bash
pnpm lint
```

### Vercel Build Commands (as configured in vercel.json)

| App | Install Command | Build Command |
|-----|----------------|---------------|
| web | (auto-detected) | (auto-detected) |
| admin | `cd ../.. && pnpm install` | `cd ../.. && pnpm turbo build --filter=@energy/admin --env-mode=loose --force` |
| super-admin | `cd ../.. && pnpm install` | `cd ../.. && pnpm turbo build --filter=@energy/super-admin --env-mode=loose --force` |

---

## 5. Runtime Commands

### Local Development

```bash
# Start all apps
pnpm dev

# Or individually:
cd apps/web && pnpm dev        # http://localhost:3000
cd apps/admin && pnpm dev      # http://localhost:3001
cd apps/super-admin && pnpm dev # http://localhost:3002
```

### Mock Sensor (simulates ESP32)

```bash
cd apps/mock-sensor
pnpm dev
```

Requires `.env` with `MOCK_API_URL`, `MOCK_DEVICE_TOKEN`, `MOCK_DEVICE_ID`.

---

## 6. Authentication Flow

### Login

1. User visits `/login` on any app
2. Enters email + password
3. Server action calls `supabase.auth.signInWithPassword()`
4. Supabase sets session cookies (`sb-*-auth-token`)
5. User redirected to dashboard (`/dashboard` for web, `/` for admin/super-admin)

### Session Refresh

- **Web app:** No middleware.ts exists. Session is validated per-route via `supabase.auth.getUser()`. **No automatic token refresh** — sessions expire after ~1 hour without refresh.
- **Admin app:** Has `proxy.ts` with `updateSession()` but **no `middleware.ts` file to wire it up**. Same situation as web.
- **Super-admin app:** No middleware.

### Access Control (`resolveAccess()`)

Every API route follows this pattern:

```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) return 401;

const access = await resolveAccess(user.id, "required_permission");
// access.customerId → tenant-scoped data
// access.permissions → granted permissions list
// access.isSuperAdmin → bypass flag
```

**Resolution order:**
1. Check `super_admins` table → if active, return ALL_PERMISSIONS + customerId="*"
2. Check `memberships` + `membership_permissions` → return first matching grant
3. Throw `AccessDeniedError` (403) if nothing matches

---

## 7. Relay API Flow

### Dual Auth on `POST /api/relay` (web app)

**Path A — Shared Secret (machine-to-machine):**
```
Admin App → POST /api/relay (admin)
  → reads RELAY_ADMIN_SECRET from env
  → attaches X-Relay-Secret header
  → forwards to Web App POST /api/relay
  → Web compares header vs env RELAY_ADMIN_SECRET
  → Match → bypass session auth → execute command
```

**Path B — Session Auth (user-initiated):**
```
Browser → POST /api/relay (web)
  → Session cookie → getUser() → resolveAccess(userId, "control_relay")
  → If granted → execute command
  → If denied → 403
```

### Command Types

- `TRIP` / `MANUAL_TRIP` — Trip the relay (cut power)
- `RESET` / `MANUAL_RESET` — Reset the relay (restore power)
- `STATUS_CHECK` — Read current relay state

### GET /api/relay

Session auth only (`view_energy` permission). Returns relay state for a device.

---

## 8. Device Ingestion Flow

### POST /api/ingest

```
ESP32 → POST /api/ingest
  → X-Device-Token header validated against devices.api_key_hash
  → Payload validated against TelemetryPayloadSchema
  → Rate limited: 1 req/sec per device
  → Written to power_readings
  → Alert threshold checks
  → Blackout detection
```

**No session auth** — device token only. Exempted from middleware redirect.

### GET /api/thresholds/esp32

Device boot-fetches safety thresholds. Also device-token auth, no session.

---

## 9. Cross-Origin Requirements

### Web App CORS

All `/api/*` routes have permissive CORS headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,OPTIONS,PATCH,DELETE,POST,PUT
Access-Control-Allow-Headers: X-CSRF-Token, X-Requested-With, Accept, ...
```

**Note:** `X-Relay-Secret` is NOT in the global CORS allow-list. The relay POST route has its own OPTIONS handler that does include it.

### Admin → Web Proxy

The admin app proxies relay requests to the web app. This is a **server-to-server** fetch (not browser cross-origin), so CORS doesn't apply. The admin server attaches `RELAY_ADMIN_SECRET` before forwarding.

---

## 10. Known Configuration Traps

### Trap 1: No App-Level Middleware

**CRITICAL:** None of the three apps have a `middleware.ts` file. The `packages/auth/src/middleware.ts` exports `updateSession()` but nothing wires it into Next.js's middleware pipeline.

**Impact:**
- Unauthenticated users can access any page (no redirect to `/login`)
- Sessions are not automatically refreshed
- Auth is enforced only at the API route level

**To fix:** Each app needs a `middleware.ts` at its root:

```typescript
// apps/web/middleware.ts (and similar for admin, super-admin)
import { updateSession } from "@energy/auth";
import { type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

### Trap 2: RELAY_ADMIN_SECRET Mismatch

If the web and admin apps have different `RELAY_ADMIN_SECRET` values, the admin proxy will fail silently (falls through to session auth, which the proxy doesn't have).

**Fix:** Set the same value in both Vercel projects.

### Trap 3: WEB_RELAY_URL Points to Production

The admin app defaults to `https://energy-monitoring-web.vercel.app/api/relay`. For staging, this must be overridden to the staging web app's URL.

**Fix:** Set `WEB_RELAY_URL` in the admin staging env to the correct staging URL.

### Trap 4: No Staging Environment Separation

There is zero staging-specific configuration in the codebase. All three apps share the same Supabase project and env vars between staging and production.

**Options:**
- Use a separate Supabase project for staging (recommended)
- Or accept shared database risk and use the same project

### Trap 5: `pnpm sync-env` Script Missing

The root `package.json` references `scripts/distribute-envs.ps1` but this file does not exist. The `pnpm dev` command depends on it.

**Impact:** `pnpm dev` will fail on the `sync-env` step. Use individual `cd apps/<app> && pnpm dev` instead.

### Trap 6: Admin App Unauthenticated API Routes

Several admin API routes (`/api/billing`, `/api/devices`, `/api/reports`, `/api/thresholds`, `/api/relay/config`) have **no auth checks**. They use the service-role client directly and trust that only authorized admins access the admin app.

**Risk:** If session middleware is not wired (see Trap 1), these routes are completely open.

---

## 11. Staging Smoke-Test Matrix

### Prerequisites

Before testing, ensure:
1. `staging` branch exists and is pushed
2. All three Vercel projects are linked to the repo
3. Env vars are set in all three Vercel projects (staging/preview scope)
4. `RELAY_ADMIN_SECRET` matches between web and admin
5. `WEB_RELAY_URL` points to staging web (not production)
6. Supabase project has the required tables and seed data

---

### AUTH Tests

| # | Test | Command / Browser Check | Expected Result |
|---|------|------------------------|-----------------|
| A1 | Unauthenticated page access | `curl -s -o /dev/null -w "%{http_code}" https://<staging-web>/dashboard` | `307` redirect to `/login` (requires middleware — see Trap 1) |
| A2 | Login page loads | Open `https://<staging-web>/login` in browser | Login form renders |
| A3 | Valid login | Enter `ronlexusplaton@gmail.com` + password, submit | Redirects to `/dashboard` |
| A4 | Invalid login | Enter wrong password, submit | Error message displayed |
| A5 | Session persists | After login, navigate to `/dashboard`, `/relay`, `/reports` | All pages load without re-login |
| A6 | Authenticated user hits /login | After login, navigate to `/login` | Redirects to `/` (not login page) |
| A7 | Logout | If logout button exists, click it → navigate to `/dashboard` | Redirected to `/login` |
| A8 | API auth (no session) | `curl -s https://<staging-web>/api/readings?deviceId=test` | `401 {"error":"Not authenticated"}` |
| A9 | API auth (valid session) | Use browser session cookie with curl or browser DevTools | `200` with readings data |
| A10 | Admin login | Open `https://<staging-admin>/login`, enter credentials | Redirects to admin dashboard |
| A11 | Super-admin login | Open `https://<staging-super-admin>/login`, enter credentials | Redirects to super-admin dashboard |

---

### TENANCY Tests

| # | Test | Command / Browser Check | Expected Result |
|---|------|------------------------|-----------------|
| T1 | WVSU membership exists | `curl -s "https://<supabase-url>/rest/v1/memberships?select=*,customer:customers(name)&user_id=eq.64f230db-5962-4f64-ab98-1e49865bfc24" -H "apikey: <service-key>" -H "Authorization: Bearer <service-key>"` | Returns OWNER membership for WVSU |
| T2 | Permissions granted | Same query, check `membership_permissions` join | 9 permissions including `control_relay` |
| T3 | Dashboard shows WVSU data | Login as `ronlexusplaton@gmail.com`, view dashboard | WVSU devices and readings displayed |
| T4 | Tenant isolation | Login as a different user (e.g., test viewer) | Only sees their own customer's data |
| T5 | Unauthorized customer access | Try to access WVSU data with a non-WVSU user session | `403 AccessDeniedError` |

---

### RELAY Tests

| # | Test | Command / Browser Check | Expected Result |
|---|------|------------------------|-----------------|
| R1 | Unauthorized relay command | `curl -s -X POST https://<staging-web>/api/relay -H "Content-Type: application/json" -d '{"action":"STATUS_CHECK","deviceId":"<device-id>"}'` | `401 {"error":"Not authenticated"}` |
| R2 | Wrong secret | `curl -s -X POST https://<staging-web>/api/relay -H "Content-Type: application/json" -H "X-Relay-Secret: wrong" -d '{"action":"STATUS_CHECK","deviceId":"<device-id>"}'` | `401` (falls through to session auth) |
| R3 | Session-based relay (OWNER) | Login as WVSU owner, navigate to relay page, click STATUS_CHECK | Relay state displayed |
| R4 | Session-based relay (VIEWER) | Login as a viewer user, try to trip relay | `403` — lacks `control_relay` permission |
| R5 | Shared-secret proxy | `curl -s -X POST https://<staging-admin>/api/relay -H "Content-Type: application/json" -H "X-Relay-Secret: <correct-secret>" -d '{"action":"STATUS_CHECK","deviceId":"<device-id>"}'` | `200` with relay state |
| R6 | Admin relay page | Login to admin app, navigate to relay page | Relay controls visible and functional |
| R7 | Relay trip | From admin or web (OWNER), issue TRIP command | Relay trips, state updates to `is_tripped: true` |
| R8 | Relay reset | From admin or web (OWNER), issue RESET command | Relay resets, state updates to `is_tripped: false` |

---

### TELEMETRY Tests

| # | Test | Command / Browser Check | Expected Result |
|---|------|------------------------|-----------------|
| E1 | Device ingest (no token) | `curl -s -X POST https://<staging-web>/api/ingest -H "Content-Type: application/json" -d '{"deviceId":"test"}'` | `401 {"error":"Missing X-Device-Token header"}` |
| E2 | Device ingest (wrong token) | `curl -s -X POST https://<staging-web>/api/ingest -H "Content-Type: application/json" -H "X-Device-Token: wrong" -d '{"deviceId":"test","voltage":220}'` | `401 {"error":"Invalid or inactive device token"}` |
| E3 | Device ingest (valid token) | `curl -s -X POST https://<staging-web>/api/ingest -H "Content-Type: application/json" -H "X-Device-Token: <device-token>" -d '{"deviceId":"<device-id>","voltage":220.5,"current":1.2,"power":264.6,"frequency":60,"power_factor":0.95}'` | `200 {"status":"ok"}` |
| E4 | Readings visible | After E3, login to web app, view dashboard | New reading appears in the chart |
| E5 | Historical readings | Navigate to `/history` | Historical data displayed |
| E6 | Reports | Navigate to `/reports`, generate summary | Consumption report renders |
| E7 | Thresholds fetch (device) | `curl -s https://<staging-web>/api/thresholds/esp32 -H "X-Device-Token: <device-token>"` | `200` with threshold values |
| E8 | Mock sensor test | Run `cd apps/mock-sensor && pnpm dev` against staging | Telemetry flows in real-time |

---

### APP-Specific Tests

| # | App | Test | Expected Result |
|---|-----|------|-----------------|
| P1 | web | Dashboard loads, shows live data | Charts render, values update |
| P2 | web | `/alerts` page loads | Alert list displays |
| P3 | web | `/billing` page loads | Billing info displayed |
| P4 | web | `/relay` page loads | Relay state and controls visible |
| P5 | web | `/reports` page loads | Report generation works |
| P6 | admin | Dashboard loads | Admin overview displays |
| P7 | admin | Device management works | Device list, config editable |
| P8 | admin | Relay logs visible | `/api/relay/logs` returns data |
| P9 | admin | Billing management works | Rate can be updated |
| P10 | super-admin | Dashboard loads | Super-admin interface renders |
| P11 | super-admin | User management works | If implemented, user list displays |

---

## 12. Post-Deploy Checklist

After merging to `staging` branch:

- [ ] Verify all three Vercel deployments succeed (check Vercel dashboard)
- [ ] Get staging URLs for all three apps
- [ ] Set `WEB_RELAY_URL` in admin staging env to staging web URL
- [ ] Verify `RELAY_ADMIN_SECRET` matches in both web and admin staging envs
- [ ] Run through AUTH tests A1-A11
- [ ] Run through TENANCY tests T1-T5
- [ ] Run through RELAY tests R1-R8
- [ ] Run through TELEMETRY tests E1-E8
- [ ] Run through APP tests P1-P11
- [ ] Document any failures with exact error messages
- [ ] Fix issues on `develop`, re-merge to `staging`
- [ ] Re-run failed tests
- [ ] Once all pass, proceed to `main` promotion

---

## 13. Staging → Production Promotion

Once staging validation passes:

```bash
git checkout main
git merge staging
git push origin main
```

Vercel will automatically deploy all three apps to production from `main`.

**Pre-promotion verification:**
- [ ] All staging tests passed
- [ ] No unreleased changes on `develop` that shouldn't go to production
- [ ] `RELAY_ADMIN_SECRET` is set in production envs (not just staging)
- [ ] `WEB_RELAY_URL` in admin production env points to production web (default is correct)
- [ ] Supabase production project has all required tables and seed data

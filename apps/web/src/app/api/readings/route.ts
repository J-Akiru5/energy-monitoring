import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getLast24hReadings, getLatestReading } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

// Force Next.js to never cache this route — it serves live sensor data.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * GET /api/readings?deviceId=<id>
 * GET /api/readings?deviceId=<id>&limit=1   ← used by the polling hook
 *
 * Returns historical readings for the dashboard chart.
 * When limit=1, also returns `age_ms` — the server-computed milliseconds
 * since the last reading. The client uses this for staleness detection
 * instead of doing its own Date.now() math against the device timestamp
 * (which can be wrong if the ESP32 clock has a timezone offset bug).
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into the query functions, which
 * explicitly filter power_readings by it. This is the actual isolation
 * boundary: the query functions use the service-role client (bypasses
 * RLS), so scoping happens here, not at the database layer.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const limit = req.nextUrl.searchParams.get("limit");

    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    // ── Authenticate the caller ───────────────────────────────
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    // ── Resolve which customer this caller is authorized for ──
    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "view_energy");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    // Fast path: polling hook requests only the latest row
    if (limit === "1") {
      const latest = await getLatestReading(deviceId, customerId);
      // Compute age on the server — immune to device clock drift
      const age_ms = latest
        ? Date.now() - new Date(latest.recorded_at).getTime()
        : null;
      return noStoreJson({ readings: latest ? [latest] : [], age_ms });
    }

    const readings = await getLast24hReadings(deviceId, customerId);
    return noStoreJson({ readings });
  } catch (err) {
    console.error("[/api/readings] Error:", err);
    return noStoreJson({ error: "Failed to fetch readings" }, 500);
  }
}

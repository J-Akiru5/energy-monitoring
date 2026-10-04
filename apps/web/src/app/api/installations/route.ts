import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getInstallationHistory, lookupControllerByDevice } from "@energy/database";
import {
  createClient,
  resolveAccess,
  AccessDeniedError,
  assertDeviceOwnership,
  DeviceAccessDeniedError,
} from "@energy/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/installations?deviceId=<uuid>
 *
 * Installation history for the device's EMU, scoped per ADR-07:
 *   - Non-Super-Admin callers: only rows belonging to their own customer
 *     (their tenancy period for that EMU).
 *   - Super Admin callers: every tenancy period for the EMU.
 *
 * Session auth with view_energy. The device must belong to the caller's
 * customer (IDOR guard) before any history is read; the EMU is then
 * resolved through the controllers bridge.
 */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, "view_energy");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    try {
      await assertDeviceOwnership(access, deviceId);
    } catch (err) {
      if (err instanceof DeviceAccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const stamp = await lookupControllerByDevice(deviceId);
    if (!stamp || !stamp.emuId) {
      return NextResponse.json(
        { error: "Device not found or access denied" },
        { status: 404 }
      );
    }

    // ADR-07: Super Admin queries are unscoped; everyone else is filtered
    // to their own customer by the query itself.
    const installations = await getInstallationHistory(
      stamp.emuId,
      access.isSuperAdmin ? undefined : access.customerId
    );

    return NextResponse.json({ installations });
  } catch (err) {
    console.error("[/api/installations] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch installation history" },
      { status: 500 }
    );
  }
}

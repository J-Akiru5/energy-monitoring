import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listDevices, deactivateDevice, lookupControllerByDevice } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "manage_devices");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const devices = await listDevices(customerId);
    return NextResponse.json({ devices });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch devices" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "manage_devices");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const { deviceId, action } = await req.json();

    if (action === "deactivate") {
      const stamp = await lookupControllerByDevice(deviceId);
      if (!stamp || stamp.customerId !== customerId) {
        return NextResponse.json(
          { error: "Device not found or access denied" },
          { status: 403 }
        );
      }

      await deactivateDevice(deviceId);
      return NextResponse.json({ status: "deactivated" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}

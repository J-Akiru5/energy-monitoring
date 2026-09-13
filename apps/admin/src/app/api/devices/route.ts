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

    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, "manage_devices");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    // Super Admins see all devices; everyone else is scoped to the customer
    // their membership grants. The "*" sentinel is a signal, not a customer
    // id — never pass it into the scoped query.
    const devices = access.isSuperAdmin
      ? await listDevices()
      : await listDevices(access.customerId);
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

    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, "manage_devices");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const { deviceId, action } = await req.json();

    if (action === "deactivate") {
      // Super Admins may manage any device (no ownership check); ordinary
      // users must own the device through their authorized customer.
      if (!access.isSuperAdmin) {
        const stamp = await lookupControllerByDevice(deviceId);
        if (!stamp || stamp.customerId !== access.customerId) {
          return NextResponse.json(
            { error: "Device not found or access denied" },
            { status: 403 }
          );
        }
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

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listDevices, deactivateDevice, lookupControllerByDevice, replaceController } from "@energy/database";
import type { Permission } from "@energy/database";
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

    const { deviceId, action } = await req.json();

    // Replacement is its own permission in the role model; everything else
    // in this route is device management.
    const requiredPermission: Permission =
      action === "replace_controller" ? "replace_device" : "manage_devices";

    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, requiredPermission);
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

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

    if (action === "replace_controller") {
      // Same ownership gate as deactivate: Super Admins may replace any
      // device; ordinary users must own it through their customer.
      if (!access.isSuperAdmin) {
        const stamp = await lookupControllerByDevice(deviceId);
        if (!stamp || stamp.customerId !== access.customerId) {
          return NextResponse.json(
            { error: "Device not found or access denied" },
            { status: 403 }
          );
        }
      }

      try {
        const result = await replaceController(deviceId);
        // deviceToken is show-once — the raw credential for the new controller.
        return NextResponse.json({
          status: "replaced",
          controllerId: result.controllerId,
          deviceId: result.deviceId,
          deviceToken: result.deviceToken,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("no ACTIVE controller")) {
          return NextResponse.json(
            { error: "No active controller to replace for this device" },
            { status: 409 }
          );
        }
        throw err;
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}

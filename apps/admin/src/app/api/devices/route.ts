import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  listDevices,
  deactivateDevice,
  lookupControllerByDevice,
  replaceController,
  decommissionEmu,
  redeployEmu,
  reassignEmuCrossCustomer,
  getLatestReading,
  getAlertThresholds,
} from "@energy/database";
import type { Permission } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export const dynamic = "force-dynamic";

const DEFAULT_OFFLINE_SECONDS = 60;

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

    // Live status: the devices table has no last-seen column. Derive it from
    // the newest power_readings row per device and flag a device offline when
    // telemetry is older than the alerting threshold — the same clock the
    // DEVICE_OFFLINE alert uses, so the badge and the alerts agree.
    let offlineSeconds = DEFAULT_OFFLINE_SECONDS;
    try {
      const thresholds = await getAlertThresholds();
      offlineSeconds = Number(thresholds?.device_offline_seconds ?? DEFAULT_OFFLINE_SECONDS);
    } catch (err) {
      console.error("[/api/devices] thresholds lookup failed:", (err as Error).message);
    }

    const nowMs = Date.now();
    const withStatus = await Promise.all(
      devices.map(async (device) => {
        const latest = await getLatestReading(
          device.id,
          access.isSuperAdmin ? undefined : access.customerId
        );
        const lastSeenMs = latest ? new Date(latest.recorded_at).getTime() : null;
        const isOnline =
          Boolean(device.is_active) &&
          lastSeenMs !== null &&
          nowMs - lastSeenMs <= offlineSeconds * 1000;

        return {
          ...device,
          last_seen_at: latest?.recorded_at ?? null,
          is_online: isOnline,
        };
      })
    );

    return NextResponse.json({
      devices: withStatus,
      offlineThresholdSeconds: offlineSeconds,
    });
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

    const { deviceId, action, siteId, buildingId, targetCustomerId } = await req.json();

    // Replacement is its own permission in the role model; reassignment
    // (RM-09) is too: both the operational path (redeploy_emu) and the
    // commercial path (reassign_emu_cross_customer) require the dedicated
    // "reassign_emu" permission — not the general manage_devices.
    const requiredPermission: Permission =
      action === "replace_controller"
        ? "replace_device"
        : action === "redeploy_emu" || action === "reassign_emu_cross_customer"
          ? "reassign_emu"
          : "manage_devices";

    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, requiredPermission);
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    // RM-12: temporary Super Admin grants are read-only — every action on
    // this route (deactivate, replace, decommission, redeploy, reassign)
    // is a mutation.
    if (access.isTemporarySuperAdmin) {
      return NextResponse.json(
        { error: "Temporary Super Admin grants are read-only" },
        { status: 403 }
      );
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

    if (action === "decommission_emu") {
      // Same ownership gate as deactivate.
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
        await decommissionEmu(deviceId);
        return NextResponse.json({ status: "decommissioned" });
      } catch (err) {
        if (
          err instanceof Error &&
          /already decommissioned|no ACTIVE controller|no active installation/.test(
            err.message
          )
        ) {
          return NextResponse.json(
            { error: "EMU cannot be decommissioned in its current state" },
            { status: 409 }
          );
        }
        throw err;
      }
    }

    if (action === "redeploy_emu") {
      if (!siteId || !buildingId) {
        return NextResponse.json(
          { error: "siteId and buildingId are required to redeploy" },
          { status: 400 }
        );
      }

      // Same ownership gate as deactivate.
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
        const result = await redeployEmu(deviceId, siteId, buildingId);
        return NextResponse.json({
          status: "redeployed",
          installationId: result.installationId,
          emuId: result.emuId,
          customerId: result.customerId,
        });
      } catch (err) {
        if (err instanceof Error) {
          if (
            /target site belongs to a different customer|target building does not belong|target site not found|target building not found/.test(
              err.message
            )
          ) {
            return NextResponse.json(
              { error: "Invalid redeploy target for this EMU" },
              { status: 400 }
            );
          }
          if (
            /not decommissioned|no ACTIVE controller|already has an active installation/.test(
              err.message
            )
          ) {
            return NextResponse.json(
              { error: "EMU cannot be redeployed in its current state" },
              { status: 409 }
            );
          }
        }
        throw err;
      }
    }

    if (action === "reassign_emu_cross_customer") {
      // Commercial reassignment is Super Admin only (decision #2, RM-09):
      // a customer-scoped caller — even an Owner — cannot move an EMU
      // into another customer's tenancy.
      if (!access.isSuperAdmin) {
        return NextResponse.json(
          { error: "Cross-customer reassignment is restricted to Super Admins" },
          { status: 403 }
        );
      }

      if (!targetCustomerId || !siteId || !buildingId) {
        return NextResponse.json(
          { error: "targetCustomerId, siteId and buildingId are required to reassign" },
          { status: 400 }
        );
      }

      try {
        const result = await reassignEmuCrossCustomer(
          deviceId,
          targetCustomerId,
          siteId,
          buildingId
        );
        return NextResponse.json({
          status: "reassigned",
          installationId: result.installationId,
          emuId: result.emuId,
          customerId: result.customerId,
        });
      } catch (err) {
        if (err instanceof Error) {
          if (
            /target customer not found|target site not found|target building not found|does not belong|is the EMU's current customer/.test(
              err.message
            )
          ) {
            return NextResponse.json(
              { error: "Invalid reassign target for this EMU" },
              { status: 400 }
            );
          }
          if (
            /not decommissioned|no ACTIVE controller|already has an active installation/.test(
              err.message
            )
          ) {
            return NextResponse.json(
              { error: "EMU cannot be reassigned in its current state" },
              { status: 409 }
            );
          }
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

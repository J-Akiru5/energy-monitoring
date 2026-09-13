import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPzemConfig, updatePzemConfig, getAlertState } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError, assertDeviceOwnership, DeviceAccessDeniedError } from "@energy/auth";
import { validateDeviceToken } from "@energy/database";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  const token = _req.headers.get("x-device-token");
  if (token) {
    const device = await validateDeviceToken(token);
    if (!device || device.id !== deviceId) {
      return noStoreJson({ error: "Invalid device token" }, 401);
    }
  } else {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    let access: Awaited<ReturnType<typeof resolveAccess>>;
    try {
      access = await resolveAccess(user.id, "view_energy");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    // IDOR guard: the URL deviceId must belong to the caller's customer.
    try {
      await assertDeviceOwnership(access, deviceId);
    } catch (err) {
      if (err instanceof DeviceAccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }
  }

  try {
    const config = await getPzemConfig(deviceId);
    return noStoreJson({
      mode: config?.mode ?? "auto",
      manualSource: config?.manualSource ?? null,
    });
  } catch (err) {
    console.error("[/api/devices/:deviceId/pzem-config] GET Error:", err);
    return noStoreJson({ error: "Failed to get PZEM config" }, 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return noStoreJson({ error: "Not authenticated" }, 401);
  }

  let access: Awaited<ReturnType<typeof resolveAccess>>;
  try {
    access = await resolveAccess(user.id, "view_energy");
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return noStoreJson({ error: err.message }, 403);
    }
    throw err;
  }

  // IDOR guard: the URL deviceId must belong to the caller's customer.
  try {
    await assertDeviceOwnership(access, deviceId);
  } catch (err) {
    if (err instanceof DeviceAccessDeniedError) {
      return noStoreJson({ error: err.message }, 403);
    }
    throw err;
  }

  try {
    const body = await req.json();
    const { mode, manualSource } = body;

    if (mode !== "auto" && mode !== "manual") {
      return noStoreJson(
        { error: "Invalid mode. Must be 'auto' or 'manual'." },
        400
      );
    }

    if (mode === "manual" && manualSource !== null) {
      if (!["A", "B", "C"].includes(manualSource)) {
        return noStoreJson(
          { error: "Invalid manualSource. Must be 'A', 'B', 'C', or null." },
          400
        );
      }

      const offlineState = await getAlertState(
        deviceId,
        "PZEM_OFFLINE",
        manualSource
      );
      if (offlineState?.isActive) {
        return noStoreJson(
          {
            status: "error",
            error: `PZEM-${manualSource} is currently unavailable because communication with the sensor has failed.`,
          },
          409
        );
      }
    }

    const effectiveSource = mode === "manual" ? manualSource : null;
    const ok = await updatePzemConfig(deviceId, mode, effectiveSource);

    if (!ok) {
      return noStoreJson({ error: "Failed to update PZEM config" }, 500);
    }

    return noStoreJson({
      status: "ok",
      mode,
      manualSource: effectiveSource,
    });
  } catch (err) {
    console.error("[/api/devices/:deviceId/pzem-config] PUT Error:", err);
    return noStoreJson({ error: "Failed to update PZEM config" }, 500);
  }
}

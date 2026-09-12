import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRelayConfig, updateRelayConfig, lookupControllerByDevice } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError, SUPER_ADMIN_CUSTOMER_ID } from "@energy/auth";
import { RelayConfigSchema } from "@energy/types";

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
 * Verify that a deviceId belongs to the resolved customerId.
 * Returns true if the device resolves to the given customer, or if
 * the caller is a Super Admin (customerId === "*").
 */
async function verifyDeviceOwnership(
  deviceId: string,
  customerId: string,
): Promise<boolean> {
  if (customerId === SUPER_ADMIN_CUSTOMER_ID) return true;

  const stamp = await lookupControllerByDevice(deviceId);
  if (!stamp || stamp.customerId !== customerId) {
    return false;
  }
  return true;
}

/**
 * Shared auth+ownership gate for GET and PUT.
 * Returns { customerId } on success, or sends an error response and returns null.
 */
async function authenticateAndScope(
  req: NextRequest,
): Promise<{ customerId: string } | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    noStoreJson({ error: "Not authenticated" }, 401);
    return null;
  }

  let customerId: string;
  try {
    const access = await resolveAccess(user.id, "control_relay");
    customerId = access.customerId;
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      noStoreJson({ error: err.message }, 403);
      return null;
    }
    throw err;
  }

  return { customerId };
}

/**
 * GET /api/relay/config?deviceId=<uuid>
 * Returns relay configuration.
 *
 * Auth: session + resolveAccess("control_relay") -> customerId.
 * Verifies the device belongs to that customer via lookupControllerByDevice.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    const auth = await authenticateAndScope(req);
    if (!auth) return new NextResponse(null, { status: 401 });

    if (!(await verifyDeviceOwnership(deviceId, auth.customerId))) {
      return noStoreJson({ error: "Device not found or access denied" }, 403);
    }

    const config = await getRelayConfig(deviceId);
    return noStoreJson({ config });
  } catch (err) {
    console.error("[admin /api/relay/config] GET Error:", err);
    return noStoreJson({ error: "Failed to get config" }, 500);
  }
}

/**
 * PUT /api/relay/config
 * Body: RelayConfig
 * Updates relay configuration.
 *
 * Auth: session + resolveAccess("control_relay") -> customerId.
 * Verifies the device belongs to that customer via lookupControllerByDevice.
 */
export async function PUT(req: NextRequest) {
  try {
    const auth = await authenticateAndScope(req);
    if (!auth) return new NextResponse(null, { status: 401 });

    const body = await req.json();
    const parsed = RelayConfigSchema.safeParse(body);

    if (!parsed.success) {
      return noStoreJson(
        { error: "Invalid config", details: parsed.error.flatten() },
        422
      );
    }

    if (!(await verifyDeviceOwnership(parsed.data.deviceId, auth.customerId))) {
      return noStoreJson({ error: "Device not found or access denied" }, 403);
    }

    const success = await updateRelayConfig(parsed.data);
    if (!success) {
      return noStoreJson({ error: "Failed to update config" }, 500);
    }

    return noStoreJson({ status: "ok" });
  } catch (err) {
    console.error("[admin /api/relay/config] PUT Error:", err);
    return noStoreJson({ error: "Internal server error" }, 500);
  }
}

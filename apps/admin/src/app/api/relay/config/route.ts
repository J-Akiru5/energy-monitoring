import { NextRequest, NextResponse } from "next/server";
import { getRelayConfig, updateRelayConfig } from "@energy/database";
import { RelayConfigSchema } from "@energy/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/relay/config?deviceId=<uuid>
 * Returns relay configuration
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const config = await getRelayConfig(deviceId);
    return NextResponse.json({ config });
  } catch (err) {
    console.error("[/api/relay/config] GET Error:", err);
    return NextResponse.json({ error: "Failed to get config" }, { status: 500 });
  }
}

/**
 * PUT /api/relay/config
 * Body: RelayConfig
 * Updates relay configuration
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RelayConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid config", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const success = await updateRelayConfig(parsed.data);
    if (!success) {
      return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[/api/relay/config] PUT Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

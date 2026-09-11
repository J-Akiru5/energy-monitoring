import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WEB_RELAY_URL = process.env.WEB_RELAY_URL ?? "https://energy-monitoring-web.vercel.app/api/relay";

/**
 * GET /api/relay?deviceId=<uuid>
 * Thin same-origin proxy: forwards relay state query to web's GET /api/relay.
 * The admin dashboard needs relay state; this avoids the client making a
 * cross-origin request directly to the web app.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const upstream = await fetch(`${WEB_RELAY_URL}?deviceId=${encodeURIComponent(deviceId)}`, {
      method: "GET",
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    console.error("[admin /api/relay] GET proxy error:", err);
    return NextResponse.json(
      { error: "Failed to reach relay service" },
      { status: 502 }
    );
  }
}

/**
 * POST /api/relay
 * Thin same-origin proxy: forwards relay commands to web's POST /api/relay,
 * attaching the shared secret server-side so it never reaches the browser.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.RELAY_ADMIN_SECRET;
  if (!secret) {
    console.error("[admin /api/relay] RELAY_ADMIN_SECRET env var is not set");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();

    const upstream = await fetch(WEB_RELAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Secret": secret,
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    console.error("[admin /api/relay] POST proxy error:", err);
    return NextResponse.json(
      { error: "Failed to reach relay service" },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WEB_RELAY_URL = process.env.WEB_RELAY_URL ?? "https://energy-monitoring-web.vercel.app/api/relay";

/**
 * POST /api/relay
 * Thin same-origin proxy: forwards relay commands to web's POST /api/relay,
 * attaching the shared secret server-side so it never reaches the browser.
 * Inherits Supabase session gating from proxy.ts's matcher automatically.
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
    console.error("[admin /api/relay] Proxy error:", err);
    return NextResponse.json(
      { error: "Failed to reach relay service" },
      { status: 502 }
    );
  }
}

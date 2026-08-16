import { updateSession } from "@energy/auth";
import { type NextRequest } from "next/server";

/**
 * Resident-app auth gate.
 *
 * "/" is the public marketing landing page and "/login" is the sign-in form —
 * both stay open. The ESP32-facing routes authenticate themselves via
 * X-Device-Token inside the route handler, so they're excluded here too
 * (both to keep them working without a browser session, and to avoid an
 * extra Supabase round-trip on every device POST).
 *
 * Everything else — /dashboard, /sensors, /history, /alerts, /reports,
 * /billing, /relay, and their supporting /api/* routes — requires a
 * signed-in resident session.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request, {
    publicPaths: ["/", "/login", "/api/ingest", "/api/heartbeat", "/api/thresholds/esp32"],
    authenticatedRedirect: "/dashboard",
  });
}

export const config = {
  matcher: [
    /*
     * Run on everything except:
     * - _next/static, _next/image (framework internals)
     * - favicon.ico, manifest.json, and the PWA/OG icon files
     * - static image extensions
     * - the ESP32-facing API routes (self-authenticate via X-Device-Token)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icon\\.png|icon-192x192\\.png|icon-512x512\\.png|apple-icon\\.png|opengraph-image\\.png|api/ingest|api/heartbeat|api/thresholds/esp32|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

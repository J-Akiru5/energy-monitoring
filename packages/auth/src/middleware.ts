import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * API routes that authenticate themselves with a per-device X-Device-Token
 * instead of a browser session. The session middleware must NOT redirect
 * these to /login — the routes return their own 401 JSON when the token is
 * missing or invalid. Keep this list in sync with device-facing endpoints.
 */
const DEVICE_API_PREFIXES = [
  "/api/ingest",
  "/api/heartbeat",
  "/api/thresholds/esp32",
  "/api/relay",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isDeviceApi = DEVICE_API_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  // If there is no active user and the user is NOT on the login page or a
  // device API route -> Redirect
  if (!user && !pathname.startsWith("/login") && !isDeviceApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If user is already logged in and tries to hit /login -> Redirect to dashboard
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

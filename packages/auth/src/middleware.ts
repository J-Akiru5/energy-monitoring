import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export interface UpdateSessionOptions {
  /**
   * Paths that do NOT require an authenticated session.
   * "/" only ever matches the exact root. Every other entry matches itself
   * or anything nested under it (e.g. "/api/ingest" also covers
   * "/api/ingest/anything"), but never as a loose string prefix — so
   * "/api/ingest" does NOT accidentally cover "/api/ingest-evil".
   * Defaults to ["/login", "/api/ingest", "/api/heartbeat"] (admin's
   * original behavior).
   */
  publicPaths?: string[];
  /** Where an already-authenticated user gets sent if they land on /login. Defaults to "/". */
  authenticatedRedirect?: string;
}

const DEFAULT_PUBLIC_PATHS = ["/login", "/api/ingest", "/api/heartbeat"];

function isPublicPath(pathname: string, publicPaths: string[]): boolean {
  return publicPaths.some((path) => {
    if (path === "/") return pathname === "/";
    const withTrailingSlash = path.endsWith("/") ? path : `${path}/`;
    return pathname === path || pathname.startsWith(withTrailingSlash);
  });
}

export async function updateSession(
  request: NextRequest,
  options: UpdateSessionOptions = {}
) {
  const publicPaths = options.publicPaths ?? DEFAULT_PUBLIC_PATHS;
  const authenticatedRedirect = options.authenticatedRedirect ?? "/";

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

  const pathname = request.nextUrl.pathname;

  // If there is no active user and the path isn't public:
  // - API routes get a clean 401 (a redirect to an HTML page breaks fetch() callers)
  // - everything else gets redirected to the login page
  if (!user && !isPublicPath(pathname, publicPaths)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If user is already logged in and tries to hit /login -> redirect away.
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = authenticatedRedirect;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

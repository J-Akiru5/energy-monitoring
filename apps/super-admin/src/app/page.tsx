import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@energy/auth";
import { ThemeToggle } from "@energy/ui";
import { isSuperAdmin, getSuperAdminGrant } from "@/lib/super-admin";
import { logout } from "./actions";

export default async function Home() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated requests are already redirected by proxy.ts; this is
  // defense in depth.
  if (!user) {
    redirect("/login");
  }

  const allowed = await isSuperAdmin(user.id);
  const grant = allowed ? await getSuperAdminGrant(user.id) : null;

  return (
    <main className="min-h-screen bg-(--canvas) text-(--text-primary) antialiased">
      <header className="flex items-center justify-between border-b border-(--border)/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-(--accent-cyan)/30 bg-(--accent-cyan)/10"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5 text-(--accent-cyan)"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">
              Syntaxure Labs
            </p>
            <p className="text-xs text-(--text-secondary)">Super Admin</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-(--text-secondary) sm:block">
            {user.email}
          </span>
          <ThemeToggle />
          <form action={logout}>
            <button
              type="submit"
              className="rounded-full border border-(--border)/75 px-3.5 py-2 text-[13px] font-semibold text-(--text-secondary) transition-colors hover:border-(--accent-cyan)/40 hover:text-(--text-primary) focus:outline-none focus:ring-2 focus:ring-(--accent-cyan)/40"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16">
        {allowed ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--accent-cyan)">
              Platform Control Plane
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Super administrator access confirmed.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-(--text-secondary)">
              Signed in as {user.email}. Cross-customer management views are
              not implemented yet. This landing page exists so authenticated
              super administrators have a real destination instead of a
              redirect loop.
            </p>

            {grant?.isTemporary && grant.expiresAt ? (
              <p className="mt-6 inline-flex items-center rounded-full border border-(--accent-amber)/40 bg-(--accent-amber)/10 px-3.5 py-1.5 text-xs font-medium text-(--accent-yellow-soft)">
                Temporary demo access — expires{" "}
                {new Date(grant.expiresAt).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Manila",
                })}{" "}
                PHT
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--accent-rose)">
              Access Restricted
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              This account is not a platform super administrator.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-(--text-secondary)">
              The Super Admin portal is limited to active super administrator
              accounts. Sign out to return to the login screen.
            </p>
            <form action={logout} className="mt-6">
              <button
                type="submit"
                className="rounded-lg bg-(--accent-cyan) px-4 py-2.5 text-sm font-semibold text-(--on-accent) transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-(--accent-cyan)/50 focus:ring-offset-2 focus:ring-offset-(--canvas)"
              >
                Sign out
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

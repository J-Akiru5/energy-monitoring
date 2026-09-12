import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@energy/auth";
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
    <main className="min-h-screen bg-[#0F172A] text-[#F8FAFC] antialiased">
      <header className="flex items-center justify-between border-b border-[#334155]/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#06B6D4]/30 bg-[#06B6D4]/10"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5 text-[#06B6D4]"
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
            <p className="text-xs text-[#94A3B8]">Super Admin</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-[#94A3B8] sm:block">
            {user.email}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-full border border-[#475569]/75 px-3.5 py-2 text-[13px] font-semibold text-[#94A3B8] transition-colors hover:border-[#06B6D4]/40 hover:text-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/40"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16">
        {allowed ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#06B6D4]">
              Platform Control Plane
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Super administrator access confirmed.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#94A3B8]">
              Signed in as {user.email}. Cross-customer management views are
              not implemented yet. This landing page exists so authenticated
              super administrators have a real destination instead of a
              redirect loop.
            </p>

            {grant?.isTemporary && grant.expiresAt ? (
              <p className="mt-6 inline-flex items-center rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-3.5 py-1.5 text-xs font-medium text-[#FCD34D]">
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E11D48]">
              Access Restricted
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              This account is not a platform super administrator.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#94A3B8]">
              The Super Admin portal is limited to active super administrator
              accounts. Sign out to return to the login screen.
            </p>
            <form action={logout} className="mt-6">
              <button
                type="submit"
                className="rounded-lg bg-[#06B6D4] px-4 py-2.5 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-[#22D3EE] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/50 focus:ring-offset-2 focus:ring-offset-[#0F172A]"
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

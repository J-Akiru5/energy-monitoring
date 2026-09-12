import type { ReactNode } from "react";

export interface AuthFeature {
  title: string;
  description: string;
}

/**
 * Primary institutional identity for the brand panel (e.g. a university).
 * When provided, this becomes the hero identity and `platformName` is
 * demoted to a small "Platform by ..." credit. Use typography only —
 * never a fabricated logo asset.
 */
export interface AuthInstitution {
  name: string;
  shortName: string;
}

/**
 * Enterprise split-layout shell for authentication screens.
 *
 * Dark "Industrial Cool" theme driven by the platform design tokens
 * (canvas #0F172A, surface #334155, accent cyan #06B6D4).
 *
 * Desktop: brand panel left / form panel right.
 * Mobile:  compact brand band on top, form immediately below.
 *
 * Server component — accepts the form (client component) as children.
 */
export function AuthSplitLayout({
  productName,
  tagline,
  headline = "Energy monitoring,\nunder control.",
  platformName = "Syntaxure Labs",
  institution,
  features,
  children,
}: {
  productName: string;
  tagline: string;
  headline?: string;
  platformName?: string;
  institution?: AuthInstitution;
  features?: AuthFeature[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#0F172A] text-[#F8FAFC] antialiased">
      {/* ── Brand panel ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden flex items-center p-6 sm:p-8 lg:p-12 lg:border-r lg:border-[#334155]/40">
        {/* Dotted grid texture */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #94A3B8 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Cyan radial glow */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 70% at 30% -10%, #06B6D41A, transparent)",
          }}
        />

        <div className="relative z-10 flex w-full items-center gap-3 lg:h-full lg:flex-col lg:items-start lg:justify-between lg:gap-0">
          {/* Identity row — always visible (compact band on mobile) */}
          <div className="flex items-center gap-3">
            {institution ? (
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#06B6D4]/30 bg-[#06B6D4]/10 text-[11px] font-bold tracking-wide text-[#06B6D4]"
              >
                {institution.shortName}
              </span>
            ) : (
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
            )}
            <span className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight">
                {institution ? institution.name : platformName}
              </span>
              <span className="text-xs text-[#94A3B8] lg:hidden">
                {productName}
              </span>
            </span>
          </div>

          {/* Headline — desktop only */}
          <div className="hidden lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#06B6D4] mb-4">
              {productName}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-[#F8FAFC] mb-3 whitespace-pre-line">
              {headline}
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-[#94A3B8]">
              {tagline}
            </p>

            {features && features.length > 0 ? (
              <dl className="mt-8 grid max-w-md grid-cols-2 gap-3">
                {features.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-xl border border-[#334155]/50 bg-[#1E293B]/50 p-4"
                  >
                    <dt className="text-xs font-semibold text-[#E2E8F0]">
                      {feature.title}
                    </dt>
                    <dd className="mt-1 text-[11px] leading-relaxed text-[#94A3B8]">
                      {feature.description}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          {/* Platform credit — only when an institution is the hero identity */}
          {institution ? (
            <p className="hidden lg:block text-[11px] uppercase tracking-[0.2em] text-[#475569]">
              Platform by {platformName}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Form panel ──────────────────────────────────────────── */}
      <section className="flex items-center justify-center p-6 sm:p-8 lg:p-12">
        <div className="w-full max-w-sm rounded-2xl border border-[#334155]/60 bg-[#1E293B]/70 p-8 shadow-[0_8px_40px_rgba(2,6,23,0.5)] backdrop-blur-xl">
          {children}
        </div>
      </section>
    </div>
  );
}

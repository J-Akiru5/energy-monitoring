import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

export interface AuthFeature {
  title: string;
  description: string;
  icon?: ReactNode;
}

export interface AuthInstitution {
  name: string;
  shortName: string;
}

/**
 * Enterprise split-layout shell for authentication screens.
 *
 * Themed via the shared platform design tokens (`theme.css`): dark
 * "Industrial Cool" by default, light mode via `<html data-theme="light">`.
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
  footer,
  children,
}: {
  productName: string;
  tagline: string;
  headline?: string;
  platformName?: string;
  institution?: AuthInstitution;
  features?: AuthFeature[];
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-(--auth-canvas) text-(--text-primary) antialiased">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>
      {/* ── Brand panel ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden flex items-center p-6 sm:p-8 lg:p-14 lg:border-r lg:border-(--line-faint)">
        {/* Atmospheric background layers */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 120% 80% at 20% 0%, #06B6D410 0%, transparent 60%), radial-gradient(ellipse 100% 60% at 80% 100%, #3B82F610 0%, transparent 50%)",
          }}
        />
        {/* Dotted grid texture */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #94A3B8 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        {/* Subtle vertical accent line */}
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 left-0 w-px opacity-30"
          style={{
            background:
              "linear-gradient(to bottom, transparent, #06B6D4 40%, #06B6D4 60%, transparent)",
          }}
        />

        <div className="relative z-10 flex w-full items-center gap-3 lg:h-full lg:flex-col lg:items-start lg:justify-between lg:gap-0">
          {/* Identity row — always visible (compact band on mobile) */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#06B6D4]/20 to-[#0891B2]/10 border border-[#06B6D4]/25 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5 text-(--accent-cyan)"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            </span>
            <span className="flex flex-col">
              <span className="text-[13px] font-semibold tracking-tight text-(--text-primary)">
                {institution ? institution.name : platformName}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-(--accent-cyan) lg:hidden">
                {productName}
              </span>
            </span>
          </div>

          {/* Headline — desktop only */}
          <div className="hidden lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-(--accent-cyan) mb-5">
              {productName}
            </p>
            <h1 className="text-[2.5rem] font-bold tracking-[-0.02em] leading-[1.1] mb-4">
              {headline.split("\n").map((line, index) => (
                <span key={index} className="block">
                  {index === 0 ? (
                    <span className="text-(--text-primary)">{line}</span>
                  ) : (
                    <span className="bg-gradient-to-r from-[#22D3EE] via-[#06B6D4] to-[#0891B2] bg-clip-text text-transparent">
                      {line}
                    </span>
                  )}
                </span>
              ))}
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-(--text-secondary)">
              {tagline}
            </p>

            {features && features.length > 0 ? (
              <dl className="mt-10 grid max-w-md grid-cols-2 gap-3">
                {features.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-xl border border-(--line-faint) bg-(--fill-faint) p-4 backdrop-blur-sm transition-colors hover:border-[#06B6D4]/20 hover:bg-[#06B6D4]/[0.03]"
                  >
                    <dt className="flex items-center gap-2.5 mb-2 text-[13px] font-semibold text-(--text-primary)">
                      {feature.icon ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#06B6D4]/10 text-(--accent-cyan)">
                          {feature.icon}
                        </span>
                      ) : null}
                      {feature.title}
                    </dt>
                    <dd className="text-[12px] leading-[1.6] text-(--text-secondary) pl-[38px]">
                      {feature.description}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          {/* Footer — desktop only */}
          {footer ? (
            <p className="hidden lg:block text-[10px] font-semibold uppercase tracking-[0.25em] text-(--text-secondary)">
              {footer}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Form panel ──────────────────────────────────────────── */}
      <section className="flex items-center justify-center p-6 sm:p-8 lg:p-14">
        <div className="w-full max-w-[400px]">
          {children}
        </div>
      </section>
    </div>
  );
}

"use client";

import { useActionState, useId, useState } from "react";

/**
 * Result returned by an app-provided login server action.
 * `void` covers actions that end in `redirect()` on success.
 */
export type LoginActionResult = { error?: string } | void;

export type LoginAction = (formData: FormData) => Promise<LoginActionResult>;

/**
 * Shared enterprise login form.
 *
 * Calls the app's EXISTING authentication server action — this component
 * standardizes the visual/interaction layer only. It never touches auth
 * logic, sessions, or redirects itself.
 */
export function LoginForm({
  action,
  heading = "Welcome back",
  subheading,
  emailPlaceholder = "user@example.com",
  submitLabel = "Sign in",
  pendingLabel = "Signing in…",
  supportingText,
  forgotPasswordHref,
}: {
  action: LoginAction;
  heading?: string;
  subheading?: string;
  emailPlaceholder?: string;
  submitLabel?: string;
  pendingLabel?: string;
  supportingText?: string;
  forgotPasswordHref?: string;
}) {
  const uid = useId();
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const errorId = `${uid}-error`;

  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      return (await action(formData)) ?? null;
    },
    null
  );

  const hasError = Boolean(state?.error);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
          {heading}
        </h2>
        {subheading ? (
          <p className="mt-1 text-sm text-[#94A3B8]">{subheading}</p>
        ) : null}
      </div>

      <form action={formAction} className="space-y-5">
        <div>
          <label
            htmlFor={emailId}
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#94A3B8]"
          >
            Email
          </label>
          <input
            id={emailId}
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder={emailPlaceholder}
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? errorId : undefined}
            className="w-full rounded-lg border border-[#475569]/60 bg-[#0F172A]/60 px-3.5 py-2.5 text-sm text-[#F8FAFC] placeholder:text-[#64748B] transition-colors focus:border-[#06B6D4] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/25"
          />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label
              htmlFor={passwordId}
              className="block text-xs font-semibold uppercase tracking-wider text-[#94A3B8]"
            >
              Password
            </label>
            {forgotPasswordHref ? (
              <a
                href={forgotPasswordHref}
                className="text-xs text-[#94A3B8] transition-colors hover:text-[#06B6D4] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/40 rounded"
              >
                Forgot password?
              </a>
            ) : null}
          </div>
          <div className="relative">
            <input
              id={passwordId}
              type={showPassword ? "text" : "password"}
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? errorId : undefined}
              className="w-full rounded-lg border border-[#475569]/60 bg-[#0F172A]/60 px-3.5 py-2.5 pr-11 text-sm text-[#F8FAFC] placeholder:text-[#64748B] transition-colors focus:border-[#06B6D4] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/25"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#64748B] transition-colors hover:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#06B6D4]/40 rounded-r-lg"
            >
              {showPassword ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {state?.error ? (
          <div
            id={errorId}
            role="alert"
            className="rounded-lg border border-[#E11D48]/40 bg-[#E11D48]/10 p-3 text-center text-sm text-[#FDA4AF]"
          >
            {state.error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#06B6D4] px-4 py-2.5 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-[#22D3EE] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/50 focus:ring-offset-2 focus:ring-offset-[#1E293B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <>
              <svg
                className="h-4 w-4 motion-safe:animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="opacity-25"
                />
                <path
                  d="M22 12a10 10 0 0 0-10-10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              {pendingLabel}
            </>
          ) : (
            submitLabel
          )}
        </button>
      </form>

      {supportingText ? (
        <p className="mt-6 text-center text-xs text-[#64748B]">
          {supportingText}
        </p>
      ) : null}
    </div>
  );
}

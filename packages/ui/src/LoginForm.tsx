"use client";

import { useActionState, useId, useState } from "react";

export type LoginActionResult = { error?: string } | void;
export type LoginAction = (formData: FormData) => Promise<LoginActionResult>;

export function LoginForm({
  action,
  heading = "Welcome back",
  subheading,
  emailPlaceholder = "you@example.com",
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
      <div className="mb-8 text-center lg:text-left">
        <h2 className="text-2xl font-bold tracking-tight text-[#F8FAFC]">
          {heading}
        </h2>
        {subheading ? (
          <p className="mt-2 text-[15px] text-[#94A3B8]/80">{subheading}</p>
        ) : null}
      </div>

      <form action={formAction} className="space-y-5">
        <div>
          <label
            htmlFor={emailId}
            className="mb-2 block text-[13px] font-medium text-[#CBD5E1]"
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
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[15px] text-[#F8FAFC] placeholder:text-[#64748B] transition-all duration-200 focus:border-[#06B6D4]/50 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 focus:bg-white/[0.05] backdrop-blur-sm"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label
              htmlFor={passwordId}
              className="text-[13px] font-medium text-[#CBD5E1]"
            >
              Password
            </label>
            {forgotPasswordHref ? (
              <a
                href={forgotPasswordHref}
                className="text-[13px] text-[#06B6D4] transition-colors hover:text-[#22D3EE] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/40 rounded"
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
              placeholder="Enter your password"
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? errorId : undefined}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 pr-12 text-[15px] text-[#F8FAFC] placeholder:text-[#64748B] transition-all duration-200 focus:border-[#06B6D4]/50 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20 focus:bg-white/[0.05] backdrop-blur-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#64748B] transition-colors hover:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#06B6D4]/40 rounded-r-xl"
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
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
            className="rounded-xl border border-[#E11D48]/30 bg-[#E11D48]/[0.08] p-3.5 text-center text-sm text-[#FDA4AF]"
          >
            {state.error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#06B6D4] to-[#0891B2] px-5 py-3.5 text-[15px] font-semibold text-[#0A0E1A] transition-all duration-200 hover:from-[#22D3EE] hover:to-[#06B6D4] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/50 focus:ring-offset-2 focus:ring-offset-[#0A0E1A] disabled:cursor-not-allowed disabled:opacity-60 shadow-[0_0_30px_rgba(6,182,212,0.2)]"
        >
          {isPending ? (
            <>
              <svg className="h-4 w-4 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {pendingLabel}
            </>
          ) : (
            <>
              {submitLabel}
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L11.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.04-1.08l3.158-2.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
              </svg>
            </>
          )}
        </button>
      </form>

      {supportingText ? (
        <p className="mt-8 text-center text-[12px] text-[#475569]">
          {supportingText}
        </p>
      ) : null}
    </div>
  );
}

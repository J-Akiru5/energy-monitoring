"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(
    async (_prevState: { error?: string } | null, formData: FormData) => {
      return await login(formData);
    },
    null
  );

  return (
    <div className="auth-screen">
      <Link href="/" className="auth-brand">
        <span className="app-shell-brand-mark">⚡</span>
        <span>Energy Monitor</span>
      </Link>

      <div className="auth-card">
        <span className="page-eyebrow">Resident Access</span>
        <h1 className="auth-title">Sign in</h1>
        <p className="page-copy">
          Track live wattage, voltage, and your estimated bill for your unit.
        </p>

        <form action={formAction} className="auth-form">
          <div className="field-group">
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="field-input auth-input"
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="field-input auth-input"
            />
          </div>

          {state?.error && <div className="auth-error">{state.error}</div>}

          <button type="submit" disabled={isPending} className="primary-btn auth-submit">
            {isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <Link href="/" className="auth-back">
          ← Back to overview
        </Link>
      </div>
    </div>
  );
}

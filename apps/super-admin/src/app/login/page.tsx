"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { AuthSplitLayout } from "@energy/ui";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      return await login(formData);
    },
    null
  );

  return (
    <AuthSplitLayout
      productName="Super Admin"
      tagline="Manage tenants, users, and system settings for Syntaxure Labs."
    >
      <form action={formAction} className="space-y-6">
        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-2">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            placeholder="admin@syntaxure.dev"
            className="w-full bg-white/50 border border-black/10 rounded-lg px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-2">
            Password
          </label>
          <input
            type="password"
            name="password"
            required
            placeholder="••••••••"
            className="w-full bg-white/50 border border-black/10 rounded-lg px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-colors"
          />
        </div>

        {state?.error && (
          <div className="text-rose-600 text-sm bg-rose-50 border border-rose-200 p-3 rounded-lg text-center">
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-mono uppercase tracking-wider text-sm py-3 px-4 rounded-lg transition-colors disabled:opacity-50 flex justify-center items-center"
        >
          {isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-zinc-500">
        <p>Access is limited to authorized accounts.</p>
      </div>
    </AuthSplitLayout>
  );
}
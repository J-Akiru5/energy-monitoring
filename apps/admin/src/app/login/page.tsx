"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { Activity } from "lucide-react";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      return await login(formData);
    },
    null
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 p-4 font-mono">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-lg p-8 shadow-2xl relative overflow-hidden">
        {/* Decorative Top Accent */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
        
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-slate-900/50 rounded-full border border-slate-700/50 mb-4 shadow-inner">
            <Activity className="w-8 h-8 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin Portal</h1>
          <p className="text-slate-400 text-sm mt-1">Authenticate to access monitoring dashboard</p>
        </div>

        <form action={formAction} className="space-y-6">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">
              Authorized Email
            </label>
            <input
              type="email"
              name="email"
              required
              placeholder="admin@isufst.edu.ph"
              className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">
              Passkey
            </label>
            <input
              type="password"
              name="password"
              required
              placeholder="••••••••"
              className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          {state?.error && (
            <div className="text-rose-400 text-sm bg-rose-950/30 border border-rose-900/50 p-3 rounded text-center">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-4 rounded transition-colors disabled:opacity-50 flex justify-center items-center"
          >
            {isPending ? "Validating..." : "Initiate Uplink"}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-slate-500">
          <p>Restricted Access. Activity is logged.</p>
        </div>
      </div>
    </div>
  );
}

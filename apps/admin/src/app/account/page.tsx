"use client";

import { useActionState, useRef } from "react";
import { updatePassword } from "./actions";

export default function AccountPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      const result = await updatePassword(formData);
      if (result.success) {
        formRef.current?.reset();
      }
      return result;
    },
    null
  );

  return (
    <>
      <div className="page-header">
        <h2>Account Management</h2>
        <p>Manage your building manager credentials.</p>
      </div>

      <div className="page-body">
        <div className="panel max-w-xl">
          <div className="panel-header">
            <h3>Security Settings</h3>
          </div>
          <div className="panel-body">
            <form ref={formRef} action={formAction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Minimum 8 characters"
                  className="form-input w-full bg-slate-800 text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  name="confirmPassword"
                  required
                  placeholder="Re-type new password"
                  className="form-input w-full bg-slate-800 text-white"
                />
              </div>

              {state?.error && (
                <div className="text-rose-400 text-sm bg-rose-950/30 border border-rose-900/50 p-3 rounded">
                  {state.error}
                </div>
              )}

              {state?.success && (
                <div className="text-emerald-400 text-sm bg-emerald-950/30 border border-emerald-900/50 p-3 rounded">
                  Password updated successfully.
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn btn-primary w-full justify-center"
                >
                  {isPending ? "Updating..." : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

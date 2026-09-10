// ──── Auth Helpers ────
// Shared utilities for one-off account creation scripts.
// Not a reusable admin feature — just avoids copy-pasting
// password generation and Admin API calls across scripts.

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate a cryptographically strong random password.
 * 20 chars, mixed case, digits, symbols — guaranteed minimum
 * from each category, Fisher-Yates shuffled.
 */
export function generatePassword(length = 20): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";
  const all = upper + lower + digits + symbols;

  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  const remaining = Array.from({ length: length - required.length }, () =>
    all[crypto.randomInt(all.length)]
  );

  const password = [...required, ...remaining];
  for (let i = password.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join("");
}

export interface CreateAuthUserResult {
  userId: string;
  password: string;
}

/**
 * Create a pre-confirmed auth user via the Supabase Admin API.
 * Returns the user ID and generated password.
 *
 * Rolls back (deletes the user) if you call the returned cleanup
 * function after a downstream failure.
 */
export async function createAuthUser(
  supabase: SupabaseClient,
  email: string,
  password?: string
): Promise<CreateAuthUserResult> {
  const pw = password ?? generatePassword();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create auth user: ${error.message}`);
  }

  return { userId: data.user.id, password: pw };
}

/**
 * Delete an auth user (for rollback on partial failure).
 */
export async function deleteAuthUser(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`Warning: failed to roll back auth user ${userId}:`, error.message);
  }
}

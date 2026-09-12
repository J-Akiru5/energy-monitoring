"use server";

import { createClient } from "@energy/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/super-admin";

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // Next.js 15 requires cookies() to be awaited before use
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Role enforcement: only active Super Admins may hold a session here.
  // Non-super-admins are signed straight back out without a session.
  if (!data.user || !(await isSuperAdmin(data.user.id))) {
    await supabase.auth.signOut();
    return { error: "This portal is restricted to platform super administrators." };
  }

  // Redirect to the super-admin dashboard
  redirect("/");
}

"use server";

import { createClient } from "@energy/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function logout() {
  const supabase = createClient(cookies);
  await supabase.auth.signOut();
  redirect("/login");
}

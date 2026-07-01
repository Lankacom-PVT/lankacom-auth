"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

/** Credentials sign-in via the library, driven by the login form. */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";

  const res = await signIn.credentials({ email, password }, { remember });

  if (!res.ok) {
    return { error: res.error ?? "Sign-in failed" };
  }
  redirect("/");
}

import type { DemoUser } from "@/lib/auth";

/**
 * Register the app's user shape ONCE, globally. After this, getSession(),
 * useSession(), SessionProvider, etc. all infer `user: DemoUser` with NO
 * explicit generic at any call site.
 */
declare module "@lankacom/auth/register" {
  interface Register {
    user: DemoUser;
  }
}

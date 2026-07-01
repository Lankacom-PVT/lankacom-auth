import { handlers } from "@/lib/auth";

// Backend logout (best-effort) + clears the session cookie.
export const POST = handlers.signout;

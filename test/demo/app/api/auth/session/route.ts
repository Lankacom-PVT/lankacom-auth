import { handlers } from "@/lib/auth";

// Read-only session snapshot consumed by the client useSession(). The library
// decodes the cookie (and may rotate), but strips the refresh token.
export const GET = handlers.session;

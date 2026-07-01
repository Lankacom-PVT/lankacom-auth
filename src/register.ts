/**
 * Stand-alone, augmentation-friendly module for the app's user type.
 *
 * This file is intentionally TINY and is shipped as its OWN entry so its module
 * name (`@lankacom/auth/register`) is stable and directly importable. Module
 * augmentation only merges when the `declare module` target is the exact module
 * that declares the interface — a dts-bundler that rolls declarations into a
 * hashed internal chunk would break that merge, so `Register` must live alone
 * here and NOT be re-bundled into other entries' hashed dts.
 *
 * Apps register their user shape once:
 *
 *   // lankacom-auth.d.ts
 *   declare module "@lankacom/auth/register" {
 *     interface Register {
 *       user: { id: string; role: "ADMIN" | "USER" };
 *     }
 *   }
 */

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Register {}

/** The app's registered user type, or a permissive default when unregistered. */
export type RegisteredUser = Register extends { user: infer U }
  ? U
  : Record<string, unknown>;

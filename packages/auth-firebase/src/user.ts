import type { FirebaseClaims } from "./types";
import type { QuickbenUser } from "@quickben/core";

/** Where roles come from: the name of a custom claim, or a function. */
export type RolesSource =
  string | ((claims: FirebaseClaims) => readonly string[] | Promise<readonly string[]>);

/** Roles from a custom claim: an array of strings, or one string. Other values give `[]`. */
export function rolesFromClaim(claims: FirebaseClaims, claim: string): string[] {
  const value = claims[claim];
  if (typeof value === "string") return value === "" ? [] : [value];
  if (Array.isArray(value)) return value.filter((role): role is string => typeof role === "string");
  return [];
}

/** The default mapping from verified claims to a `QuickbenUser`. */
export async function claimsToUser(
  claims: FirebaseClaims,
  roles: RolesSource,
): Promise<QuickbenUser> {
  const user: QuickbenUser = {
    id: claims.uid,
    emailVerified: claims.email_verified === true,
    roles: typeof roles === "string" ? rolesFromClaim(claims, roles) : [...(await roles(claims))],
  };
  if (typeof claims.email === "string") user.email = claims.email;
  return user;
}

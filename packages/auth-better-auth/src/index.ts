export { betterAuthAdapter, splitRoles } from "./adapter";
export { tenancySync, withActiveOrganizationCookie } from "./tenancy";

export type {
  BetterAuthAdapterOptions,
  BetterAuthInstance,
  BetterAuthSession,
  BetterAuthUser,
} from "./adapter";
export type {
  ActiveOrganizationCookieOptions,
  TenancySyncHooks,
  TenancySyncOptions,
} from "./tenancy";

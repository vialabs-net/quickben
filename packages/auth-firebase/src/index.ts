export { firebaseAuth } from "./adapter";
export { defaultAdminAuth } from "./admin-sdk";
export { readCookie, serializeCookie } from "./cookies";
export { claimsToUser, rolesFromClaim } from "./user";

export type {
  FirebaseAuth,
  FirebaseAuthOptions,
  SessionErrorReason,
  SessionHandlers,
  SessionResponse,
  SessionRouteHandler,
} from "./adapter";
export type { AuthSource } from "./admin-sdk";
export type { CookieOptions } from "./cookies";
export type { FirebaseAdminAuth, FirebaseClaims } from "./types";
export type { RolesSource } from "./user";

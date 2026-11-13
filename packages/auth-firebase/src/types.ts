/**
 * Claims of a verified Firebase ID token or session cookie. The real `DecodedIdToken` of
 * `firebase-admin` fits this shape. Custom claims are extra keys.
 */
export interface FirebaseClaims {
  /** Firebase user id. */
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  /** Sign-in time, in seconds since the epoch. */
  auth_time: number;
  /** Expiry, in seconds since the epoch. */
  exp: number;
  [claim: string]: unknown;
}

/**
 * The part of the `firebase-admin` `Auth` API this package uses. Pass `getAuth()` from
 * `firebase-admin/auth`, or a fake in tests.
 */
export interface FirebaseAdminAuth {
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<FirebaseClaims>;
  createSessionCookie(idToken: string, options: { expiresIn: number }): Promise<string>;
  verifySessionCookie(sessionCookie: string, checkRevoked?: boolean): Promise<FirebaseClaims>;
  revokeRefreshTokens(uid: string): Promise<void>;
}

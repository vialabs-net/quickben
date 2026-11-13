import { vi } from "vitest";

import type { FirebaseAdminAuth, FirebaseClaims } from "../src";

/** An error shaped like the ones of firebase-admin. */
export function firebaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

const now = () => Math.floor(Date.now() / 1000);

/** Claims of a fresh sign-in. */
export function claims(extra: Partial<FirebaseClaims> = {}): FirebaseClaims {
  return {
    uid: "u1",
    email: "ada@example.com",
    email_verified: true,
    auth_time: now() - 10,
    exp: now() + 3600,
    ...extra,
  };
}

/**
 * A fake `firebase-admin` Auth. ID tokens and session cookies are looked up in maps; unknown
 * values throw like the real SDK.
 */
export function fakeAdmin() {
  const idTokens = new Map<string, FirebaseClaims>();
  const cookies = new Map<string, FirebaseClaims>();
  const revoked = new Set<string>();
  const auth = {
    verifyIdToken: vi.fn((token: string, checkRevoked?: boolean) => {
      const found = idTokens.get(token);
      if (!found) return Promise.reject(firebaseError("auth/argument-error"));
      if (checkRevoked === true && revoked.has(found.uid)) {
        return Promise.reject(firebaseError("auth/id-token-revoked"));
      }
      return Promise.resolve(found);
    }),
    createSessionCookie: vi.fn((token: string, options: { expiresIn: number }) => {
      const found = idTokens.get(token);
      if (!found) return Promise.reject(firebaseError("auth/invalid-id-token"));
      const cookie = `session.${token}.${String(options.expiresIn)}`;
      cookies.set(cookie, found);
      return Promise.resolve(cookie);
    }),
    verifySessionCookie: vi.fn((cookie: string, checkRevoked?: boolean) => {
      const found = cookies.get(cookie);
      if (!found) return Promise.reject(firebaseError("auth/session-cookie-expired"));
      if (checkRevoked === true && revoked.has(found.uid)) {
        return Promise.reject(firebaseError("auth/session-cookie-revoked"));
      }
      return Promise.resolve(found);
    }),
    revokeRefreshTokens: vi.fn((uid: string) => {
      revoked.add(uid);
      return Promise.resolve();
    }),
  } satisfies FirebaseAdminAuth;
  return { auth, idTokens, cookies, revoked };
}

/** A request to the session route. */
export function sessionRequest(
  method: string,
  init: { body?: unknown; headers?: Record<string, string>; url?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let body: string | undefined;
  if (typeof init.body === "string") body = init.body;
  else if (init.body !== undefined) body = JSON.stringify(init.body);
  return new Request(init.url ?? "http://localhost:3000/api/auth/session", {
    method,
    headers,
    body,
  });
}

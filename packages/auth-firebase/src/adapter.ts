import { ConfigError } from "@quickben/core";
import { assertSameOrigin, errorResponse, HttpError } from "@quickben/next";

import { authLoader } from "./admin-sdk";
import { readCookie, serializeCookie } from "./cookies";
import { claimsToUser } from "./user";

import type { AuthSource } from "./admin-sdk";
import type { CookieOptions } from "./cookies";
import type { FirebaseAdminAuth, FirebaseClaims } from "./types";
import type { RolesSource } from "./user";
import type { AuthAdapter, QuickbenUser } from "@quickben/core";
import type { CsrfOptions } from "@quickben/next";

/** Options of {@link firebaseAuth}. */
export interface FirebaseAuthOptions {
  /**
   * The `firebase-admin` Auth API, or a function that returns it. Default: `getAuth()` of the
   * default app, created with `initializeApp()` (Application Default Credentials).
   */
  auth?: AuthSource;
  /** Name of the session cookie. Default `__session` (the only cookie Firebase Hosting forwards). */
  cookieName?: string;
  /** Attributes of the session cookie. */
  cookie?: CookieOptions;
  /** Lifetime of a session, in seconds. 5 minutes to 14 days. Default 5 days. */
  sessionMaxAge?: number;
  /**
   * Check on every request that the user's refresh tokens were not revoked. It costs one call
   * to Firebase per request. Default `true`.
   */
  checkRevoked?: boolean;
  /**
   * A session can only be created from an ID token of a sign-in this recent, in seconds. It
   * stops a stolen old ID token from opening a 14-day session. `0` turns the check off.
   * Default `300`.
   */
  maxAuthAge?: number;
  /** Refuse to create a session for an unverified email. Default `false`. */
  requireVerifiedEmail?: boolean;
  /** Roles: the name of a custom claim, or a function of the claims. Default `roles`. */
  roles?: RolesSource;
  /**
   * Final say on the user. Gets the verified claims and the default mapping. Return `null` to
   * refuse the user: no session is created and requests stay anonymous. Use it to look up
   * your own user record, or to allow only provisioned accounts.
   */
  resolveUser?: (
    claims: FirebaseClaims,
    user: QuickbenUser,
  ) => QuickbenUser | null | Promise<QuickbenUser | null>;
  /** Also accept `Authorization: Bearer <ID token>`, for API clients. Default `false`. */
  bearer?: boolean;
  /**
   * Sign-out also revokes the user's refresh tokens, which signs them out on every device.
   * Default `false`.
   */
  revokeOnSignOut?: boolean;
  /** Same-origin check of the session routes. */
  csrf?: CsrfOptions;
}

/** Why the session route refused a sign-in. Sent as `error.details.reason`. */
export type SessionErrorReason =
  | "invalid-request"
  | "invalid-token"
  | "revoked"
  | "stale-sign-in"
  | "email-not-verified"
  | "not-provisioned";

/** Body of `POST` and `GET` on the session route. */
export interface SessionResponse {
  user: QuickbenUser | null;
}

/** A Next.js route handler. */
export type SessionRouteHandler = (req: Request) => Promise<Response>;

/** Handlers to export from `app/api/auth/session/route.ts`. */
export interface SessionHandlers {
  /** The current user, or `null`. */
  GET: SessionRouteHandler;
  /** Body `{ idToken, remember? }`: verify the ID token and set the session cookie. */
  POST: SessionRouteHandler;
  /** Clear the session cookie (and revoke tokens with `revokeOnSignOut`). */
  DELETE: SessionRouteHandler;
}

/** The adapter returned by {@link firebaseAuth}. */
export interface FirebaseAuth extends AuthAdapter {
  /** The user of a request with a valid session cookie (or bearer token), else `null`. */
  getUser(req: Request): Promise<QuickbenUser | null>;
  /** Verified claims of the request's session cookie (or bearer token), else `null`. */
  verify(req: Request): Promise<FirebaseClaims | null>;
  /** Route handlers that create, read and clear the session cookie. */
  readonly handlers: SessionHandlers;
  /** Revoke a user's refresh tokens: every session of that user ends. */
  revokeSessions(uid: string): Promise<void>;
  /** Name of the session cookie. */
  readonly cookieName: string;
}

const MIN_SESSION = 5 * 60;
const MAX_SESSION = 14 * 24 * 60 * 60;
const MAX_BODY_BYTES = 16 * 1024;

class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly reason: SessionErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

/** Errors thrown by the Firebase SDKs carry a `code` such as `auth/id-token-expired`. */
function firebaseCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "string" && code.includes("/") ? code : null;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const response = Response.json(body, { status, headers });
  response.headers.set("cache-control", "no-store");
  return response;
}

function sessionErrorResponse(error: SessionError, setCookie?: string): Response {
  const codes: Record<number, string> = { 401: "UNAUTHORIZED", 403: "FORBIDDEN" };
  const code = codes[error.status] ?? "VALIDATION";
  const response = json(
    { error: { code, message: error.message, details: { reason: error.reason } } },
    error.status,
  );
  if (setCookie) response.headers.append("set-cookie", setCookie);
  return response;
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  const token = header.slice(7).trim();
  return token === "" ? undefined : token;
}

async function readSessionBody(req: Request): Promise<{ idToken: string; remember: boolean }> {
  const type = req.headers.get("content-type") ?? "";
  // A JSON body cannot be sent cross-site without a CORS preflight.
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the ID token as application/json");
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const { idToken, remember } = (body ?? {}) as { idToken?: unknown; remember?: unknown };
  if (typeof idToken !== "string" || idToken.trim() === "") {
    throw new SessionError(400, "invalid-request", "Body must be { idToken, remember? }");
  }
  if (remember !== undefined && typeof remember !== "boolean") {
    throw new SessionError(400, "invalid-request", "`remember` must be a boolean");
  }
  return { idToken: idToken.trim(), remember: remember ?? true };
}

/**
 * Firebase Authentication for Quickben, with session cookies.
 *
 * The browser signs in with the Firebase client SDK and posts the ID token to the session
 * route. The route verifies it and sets an `HttpOnly` session cookie made by
 * `createSessionCookie`. `getUser` verifies that cookie on every request.
 *
 * ```ts
 * // lib/auth.ts
 * export const firebase = firebaseAuth({ roles: "roles" });
 * // quickben.config.ts: defineConfig({ …, auth: firebase })
 * // app/api/auth/session/route.ts
 * export const { GET, POST, DELETE } = firebase.handlers;
 * ```
 */
export function firebaseAuth(options: FirebaseAuthOptions = {}): FirebaseAuth {
  const loadAuth = authLoader(options.auth);
  const cookieName = options.cookieName ?? "__session";
  const cookieOptions = options.cookie ?? {};
  const sessionMaxAge = options.sessionMaxAge ?? 5 * 24 * 60 * 60;
  if (
    !Number.isFinite(sessionMaxAge) ||
    sessionMaxAge < MIN_SESSION ||
    sessionMaxAge > MAX_SESSION
  ) {
    throw new ConfigError("firebaseAuth: `sessionMaxAge` must be between 300 and 1209600 seconds");
  }
  const checkRevoked = options.checkRevoked ?? true;
  const maxAuthAge = options.maxAuthAge ?? 300;
  const roles = options.roles ?? "roles";

  async function toUser(claims: FirebaseClaims): Promise<QuickbenUser | null> {
    const user = await claimsToUser(claims, roles);
    return options.resolveUser ? options.resolveUser(claims, user) : user;
  }

  async function verifyWith(
    run: (auth: FirebaseAdminAuth) => Promise<FirebaseClaims>,
  ): Promise<FirebaseClaims | null> {
    const auth = await loadAuth();
    try {
      return await run(auth);
    } catch (error) {
      // Expired, revoked or malformed tokens make the request anonymous. Anything else, such
      // as missing credentials, is a server error and is not hidden.
      if (firebaseCode(error) !== null) return null;
      throw error;
    }
  }

  function verify(req: Request): Promise<FirebaseClaims | null> {
    const cookie = readCookie(req, cookieName);
    if (cookie !== undefined) {
      return verifyWith((auth) => auth.verifySessionCookie(cookie, checkRevoked));
    }
    const token = options.bearer === true ? bearerToken(req) : undefined;
    if (token !== undefined) return verifyWith((auth) => auth.verifyIdToken(token, checkRevoked));
    return Promise.resolve(null);
  }

  async function getUser(req: Request): Promise<QuickbenUser | null> {
    const claims = await verify(req);
    return claims ? toUser(claims) : null;
  }

  const clearCookie = (req: Request) => serializeCookie(req, cookieName, "", cookieOptions, 0);

  async function verifySignIn(idToken: string): Promise<FirebaseClaims> {
    const auth = await loadAuth();
    try {
      // checkRevoked: after "sign out everywhere" a device may still hold an unexpired ID token.
      return await auth.verifyIdToken(idToken, true);
    } catch (error) {
      const code = firebaseCode(error);
      if (code === null) throw error;
      if (code === "auth/id-token-revoked" || code === "auth/user-disabled") {
        throw new SessionError(401, "revoked", "This sign-in was revoked. Sign in again.");
      }
      throw new SessionError(401, "invalid-token", "Invalid or expired ID token");
    }
  }

  async function createSession(req: Request): Promise<Response> {
    assertSameOrigin(req, options.csrf);
    const { idToken, remember } = await readSessionBody(req);
    const claims = await verifySignIn(idToken);
    if (maxAuthAge > 0 && Date.now() / 1000 - claims.auth_time > maxAuthAge) {
      throw new SessionError(401, "stale-sign-in", "Sign in again to start a session");
    }
    if (options.requireVerifiedEmail === true && claims.email_verified !== true) {
      throw new SessionError(403, "email-not-verified", "Verify your email address first");
    }
    const user = await toUser(claims);
    if (!user) {
      throw new SessionError(403, "not-provisioned", "This account has no access");
    }
    const auth = await loadAuth();
    const session = await auth.createSessionCookie(idToken, { expiresIn: sessionMaxAge * 1000 });
    const response = json({ user } satisfies SessionResponse);
    response.headers.append(
      "set-cookie",
      serializeCookie(
        req,
        cookieName,
        session,
        cookieOptions,
        remember ? sessionMaxAge : undefined,
      ),
    );
    return response;
  }

  async function deleteSession(req: Request): Promise<Response> {
    assertSameOrigin(req, options.csrf);
    if (options.revokeOnSignOut === true) {
      const cookie = readCookie(req, cookieName);
      const claims = cookie
        ? await verifyWith((auth) => auth.verifySessionCookie(cookie, false))
        : null;
      if (claims) await (await loadAuth()).revokeRefreshTokens(claims.uid);
    }
    const response = json({ user: null } satisfies SessionResponse);
    response.headers.append("set-cookie", clearCookie(req));
    return response;
  }

  function guard(run: (req: Request) => Promise<Response>): SessionRouteHandler {
    return async (req) => {
      try {
        return await run(req);
      } catch (error) {
        // A refused sign-in also drops any older session cookie of this browser.
        if (error instanceof SessionError) return sessionErrorResponse(error, clearCookie(req));
        return errorResponse(error);
      }
    };
  }

  return {
    cookieName,
    getUser,
    verify,
    handlers: {
      GET: guard(async (req) => json({ user: await getUser(req) } satisfies SessionResponse)),
      POST: guard(createSession),
      DELETE: guard(deleteSession),
    },
    async revokeSessions(uid) {
      await (await loadAuth()).revokeRefreshTokens(uid);
    },
  };
}

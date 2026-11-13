import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as signOutFirebase,
} from "firebase/auth";

import type { SessionErrorReason } from "../adapter";
import type { QuickbenUser } from "@quickben/core";
import type { FirebaseOptions } from "firebase/app";
import type { Auth, User, UserCredential } from "firebase/auth";

/** Default URL of the session route (`app/api/auth/session/route.ts`). */
export const defaultSessionEndpoint = "/api/auth/session";

/** Default `localStorage` key that tells other tabs which user is signed in. */
export const defaultIdentityKey = "quickben.auth.user";

/**
 * The Firebase Auth instance of a web config. The app is created once per config name, so
 * repeated calls (also from several components) share it.
 */
export function getFirebaseAuth(config: FirebaseOptions, name = "[DEFAULT]"): Auth {
  const app = getApps().some((existing) => existing.name === name)
    ? getApp(name)
    : initializeApp(config, name);
  return getAuth(app);
}

/** Options of {@link createSessionClient}. */
export interface SessionClientOptions {
  /** The Firebase Auth instance, or a function that returns it. */
  auth?: Auth | (() => Auth | Promise<Auth>);
  /** Web config of the Firebase project. Used when `auth` is not given. */
  firebaseConfig?: FirebaseOptions;
  /** URL of the session route. Default `/api/auth/session`. */
  endpoint?: string;
  /** `localStorage` key that tells other tabs who is signed in. Default `quickben.auth.user`. */
  identityKey?: string;
}

/** Options of a sign-in. */
export interface SignInOptions {
  /** Keep the session after the browser closes. Default `true`. */
  remember?: boolean;
}

/** The session route refused the request. */
export class SessionRequestError extends Error {
  /** HTTP status. */
  readonly status: number;
  /** Error code of the response, such as `UNAUTHORIZED`. */
  readonly code: string;
  /** Why a sign-in was refused, when the server says. */
  readonly reason: SessionErrorReason | null;

  constructor(status: number, code: string, message: string, reason: SessionErrorReason | null) {
    super(message);
    this.name = "SessionRequestError";
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

/** Browser helper around the session route. */
export interface FirebaseSessionClient {
  /** Post a Firebase user's ID token and get the session cookie. */
  createSession(user: User, options?: SignInOptions): Promise<QuickbenUser>;
  /** Google popup, then {@link createSession}. */
  signInWithGoogle(
    options?: SignInOptions & { provider?: GoogleAuthProvider },
  ): Promise<QuickbenUser>;
  /** A Google ID token (from One Tap), then {@link createSession}. */
  signInWithGoogleIdToken(idToken: string, options?: SignInOptions): Promise<QuickbenUser>;
  /** Email and password, then {@link createSession}. */
  signInWithPassword(
    email: string,
    password: string,
    options?: SignInOptions,
  ): Promise<QuickbenUser>;
  /** Clear the session cookie and tell other tabs. */
  signOut(): Promise<void>;
  /** The user of the current session cookie, or `null`. */
  getSessionUser(): Promise<QuickbenUser | null>;
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { reason?: SessionErrorReason } | null };
}

async function toError(response: Response): Promise<SessionRequestError> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Not JSON: keep the defaults below.
  }
  return new SessionRequestError(
    response.status,
    body.error?.code ?? "INTERNAL",
    body.error?.message ?? `Session request failed (${String(response.status)})`,
    body.error?.details?.reason ?? null,
  );
}

/** Write or remove the shared identity. Storage can be unavailable (private mode). */
export function publishIdentity(key: string, userId: string | null): void {
  try {
    if (userId === null) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, userId);
  } catch {
    // Other tabs then find out on their next check.
  }
}

/** A Google provider that always shows the account chooser. */
export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * Browser helper for the session route of `firebaseAuth()`.
 *
 * Sign-ins use in-memory persistence and sign the Firebase client out once the server has set
 * the session cookie: the cookie is the only session, as Firebase recommends for session
 * cookies. Each sign-in and sign-out writes the user id to `localStorage`, so other tabs can
 * notice an account change (see `SessionKeeper`).
 */
export function createSessionClient(options: SessionClientOptions = {}): FirebaseSessionClient {
  const endpoint = options.endpoint ?? defaultSessionEndpoint;
  const identityKey = options.identityKey ?? defaultIdentityKey;

  async function loadAuth(): Promise<Auth> {
    if (typeof options.auth === "function") return options.auth();
    if (options.auth) return options.auth;
    if (options.firebaseConfig) return getFirebaseAuth(options.firebaseConfig);
    throw new Error("createSessionClient needs `auth` or `firebaseConfig`");
  }

  async function createSession(user: User, signIn: SignInOptions = {}): Promise<QuickbenUser> {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: await user.getIdToken(), remember: signIn.remember ?? true }),
    });
    if (!response.ok) throw await toError(response);
    const body = (await response.json()) as { user: QuickbenUser };
    publishIdentity(identityKey, body.user.id);
    return body.user;
  }

  async function signInWith(
    signIn: SignInOptions,
    run: (auth: Auth) => Promise<UserCredential>,
  ): Promise<QuickbenUser> {
    const auth = await loadAuth();
    await setPersistence(auth, inMemoryPersistence);
    try {
      const credential = await run(auth);
      return await createSession(credential.user, signIn);
    } finally {
      await signOutFirebase(auth).catch(() => undefined);
    }
  }

  return {
    createSession,
    signInWithGoogle: ({ provider, ...signIn } = {}) =>
      signInWith(signIn, (auth) => signInWithPopup(auth, provider ?? googleProvider())),
    signInWithGoogleIdToken: (idToken, signIn = {}) =>
      signInWith(signIn, (auth) =>
        signInWithCredential(auth, GoogleAuthProvider.credential(idToken)),
      ),
    signInWithPassword: (email, password, signIn = {}) =>
      signInWith(signIn, (auth) => signInWithEmailAndPassword(auth, email.trim(), password)),
    async signOut() {
      const response = await fetch(endpoint, { method: "DELETE", credentials: "same-origin" });
      publishIdentity(identityKey, null);
      if (!response.ok) throw await toError(response);
    },
    async getSessionUser() {
      const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw await toError(response);
      return ((await response.json()) as { user: QuickbenUser | null }).user;
    },
  };
}

import { ConfigError } from "@quickben/core";

import type { FirebaseAdminAuth } from "./types";
import type * as AppModule from "firebase-admin/app";
import type * as AuthModule from "firebase-admin/auth";

/** Where the adapter gets the `firebase-admin` Auth API from. */
export type AuthSource = FirebaseAdminAuth | (() => FirebaseAdminAuth | Promise<FirebaseAdminAuth>);

/**
 * `getAuth()` of the default `firebase-admin` app. The app is created on first use with
 * Application Default Credentials (`initializeApp()`), unless the app already created one.
 */
export async function defaultAdminAuth(): Promise<FirebaseAdminAuth> {
  let app: typeof AppModule;
  let auth: typeof AuthModule;
  try {
    [app, auth] = await Promise.all([import("firebase-admin/app"), import("firebase-admin/auth")]);
  } catch (error) {
    throw new ConfigError(
      "@quickben/auth-firebase needs firebase-admin: install it, or pass `auth` to firebaseAuth()",
      { cause: error },
    );
  }
  const current = app.getApps()[0] ?? app.initializeApp();
  return auth.getAuth(current);
}

/** Memoized loader for an {@link AuthSource}. A failed load is retried on the next call. */
export function authLoader(
  source: AuthSource | undefined,
  load: () => Promise<FirebaseAdminAuth> = defaultAdminAuth,
): () => Promise<FirebaseAdminAuth> {
  if (source !== undefined && typeof source !== "function") return () => Promise.resolve(source);
  const create = source ?? load;
  let pending: Promise<FirebaseAdminAuth> | null = null;
  return () => {
    pending ??= Promise.resolve()
      .then(create)
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}

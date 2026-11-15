import { defineMessages, englishI18n } from "@quickben/admin/i18n";

import { SessionRequestError } from "../client/session-client";

import type { MessageKey, Translator } from "@quickben/admin/i18n";

/**
 * Messages of the Firebase sign-in page, namespace `auth-firebase`. Override any of them with
 * `admin.messages` in the config: `{ es: { "auth-firebase.title": "Entrar" } }`.
 */
export const firebaseAuthMessages = defineMessages("auth-firebase", {
  en: {
    title: "Sign in",
    google: "Continue with Google",
    signingIn: "Signing in…",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    remember: "Keep me signed in",

    "error.failed": "Sign-in failed. Try again.",
    "error.invalid-token": "The sign-in could not be verified. Try again.",
    "error.revoked": "This sign-in was revoked. Sign in again.",
    "error.stale-sign-in": "The sign-in took too long. Try again.",
    "error.email-not-verified": "Verify your email address, then sign in again.",
    "error.not-provisioned": "This account has no access. Ask an administrator to add you.",
    "error.wrong-credentials": "Wrong email or password.",
    "error.invalid-email": "Enter a valid email address.",
    "error.user-disabled": "This account is disabled.",
    "error.too-many-requests": "Too many attempts. Wait a moment and try again.",
    "error.popup-blocked": "The browser blocked the sign-in window. Allow popups and try again.",
    "error.account-exists": "This email already signs in with another method.",
    "error.operation-not-allowed": "This sign-in method is not enabled.",
    "error.unauthorized-domain": "This domain is not authorized for sign-in.",
    "error.network": "Network error. Check your connection and try again.",
  },
  es: {
    title: "Iniciar sesión",
    google: "Continuar con Google",
    signingIn: "Iniciando sesión…",
    email: "Correo",
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a field label, not a password
    password: "Contraseña",
    submit: "Iniciar sesión",
    remember: "Mantener la sesión iniciada",

    "error.failed": "No se pudo iniciar sesión. Inténtalo de nuevo.",
    "error.invalid-token": "No se pudo verificar el inicio de sesión. Inténtalo de nuevo.",
    "error.revoked": "Este inicio de sesión fue revocado. Vuelve a iniciar sesión.",
    "error.stale-sign-in": "El inicio de sesión tardó demasiado. Inténtalo de nuevo.",
    "error.email-not-verified": "Verifica tu correo y vuelve a iniciar sesión.",
    "error.not-provisioned": "Esta cuenta no tiene acceso. Pide a un administrador que te agregue.",
    "error.wrong-credentials": "Correo o contraseña incorrectos.",
    "error.invalid-email": "Ingresa un correo válido.",
    "error.user-disabled": "Esta cuenta está desactivada.",
    "error.too-many-requests": "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
    "error.popup-blocked":
      "El navegador bloqueó la ventana de inicio de sesión. Permite las ventanas emergentes e inténtalo de nuevo.",
    "error.account-exists": "Este correo ya inicia sesión con otro método.",
    "error.operation-not-allowed": "Este método de inicio de sesión no está habilitado.",
    "error.unauthorized-domain": "Este dominio no está autorizado para iniciar sesión.",
    "error.network": "Error de red. Revisa tu conexión e inténtalo de nuevo.",
  },
});

type FirebaseAuthKey = MessageKey<typeof firebaseAuthMessages>;

/** Translate function of the Firebase sign-in messages. */
export type FirebaseAuthT = Translator<FirebaseAuthKey>["t"];

const serverMessages: Readonly<Record<string, FirebaseAuthKey>> = {
  "invalid-token": "error.invalid-token",
  revoked: "error.revoked",
  "stale-sign-in": "error.stale-sign-in",
  "email-not-verified": "error.email-not-verified",
  "not-provisioned": "error.not-provisioned",
};

const firebaseMessages: Readonly<Record<string, FirebaseAuthKey>> = {
  "auth/invalid-credential": "error.wrong-credentials",
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a Firebase error code, not a password
  "auth/wrong-password": "error.wrong-credentials",
  "auth/user-not-found": "error.wrong-credentials",
  "auth/invalid-email": "error.invalid-email",
  "auth/user-disabled": "error.user-disabled",
  "auth/too-many-requests": "error.too-many-requests",
  "auth/popup-blocked": "error.popup-blocked",
  "auth/account-exists-with-different-credential": "error.account-exists",
  "auth/operation-not-allowed": "error.operation-not-allowed",
  "auth/unauthorized-domain": "error.unauthorized-domain",
  "auth/network-request-failed": "error.network",
};

/** Firebase codes that mean the person closed the window: no message. */
const dismissed = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

function own(map: Readonly<Record<string, FirebaseAuthKey>>, code: string | null | undefined) {
  return code && Object.hasOwn(map, code) ? map[code] : undefined;
}

const english = englishI18n.scope(firebaseAuthMessages).t;

/**
 * A message for a failed sign-in, or `null` when the person cancelled it. Pass `t` from
 * `i18n.scope(firebaseAuthMessages)` for another locale; the default is English.
 */
export function signInErrorMessage(error: unknown, t: FirebaseAuthT = english): string | null {
  if (error instanceof SessionRequestError) {
    return t(own(serverMessages, error.reason) ?? "error.failed");
  }
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (dismissed.has(code)) return null;
  return t(own(firebaseMessages, code) ?? "error.failed");
}

/**
 * The `next` search parameter when it is a path on this site, else `fallback`. Blocks open
 * redirects such as `//evil.example` or `/\evil.example`.
 */
export function safeRedirect(next: string | null | undefined, fallback: string): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const base = "https://quickben.invalid";
    const url = new URL(next, base);
    // Dot segments can turn a local path into a protocol-relative one.
    if (url.origin !== base || url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

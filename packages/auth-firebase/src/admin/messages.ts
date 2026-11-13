import { SessionRequestError } from "../client/session-client";

const serverMessages: Record<string, string> = {
  "invalid-token": "The sign-in could not be verified. Try again.",
  revoked: "This sign-in was revoked. Sign in again.",
  "stale-sign-in": "The sign-in took too long. Try again.",
  "email-not-verified": "Verify your email address, then sign in again.",
  "not-provisioned": "This account has no access. Ask an administrator to add you.",
};

const firebaseMessages: Record<string, string> = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/user-disabled": "This account is disabled.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/popup-blocked": "The browser blocked the sign-in window. Allow popups and try again.",
  "auth/account-exists-with-different-credential":
    "This email already signs in with another method.",
  "auth/operation-not-allowed": "This sign-in method is not enabled.",
  "auth/unauthorized-domain": "This domain is not authorized for sign-in.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
};

/** Firebase codes that mean the person closed the window: no message. */
const dismissed = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

/** A message for a failed sign-in, or `null` when the person cancelled it. */
export function signInErrorMessage(error: unknown): string | null {
  if (error instanceof SessionRequestError) {
    return (error.reason && serverMessages[error.reason]) ?? "Sign-in failed. Try again.";
  }
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (dismissed.has(code)) return null;
  return firebaseMessages[code] ?? "Sign-in failed. Try again.";
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

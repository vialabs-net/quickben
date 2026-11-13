"use client";

/** Better Auth sign-out, then back to the sign-in page. */
export function SignOutButton() {
  async function signOut() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    globalThis.location.assign("/sign-in");
  }
  return (
    <button type="button" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}

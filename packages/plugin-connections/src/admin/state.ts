/** Result of a form action. Same shape as the admin's own forms. */
export type FormState =
  { status: "idle" } | { status: "error"; message: string; fieldErrors: Record<string, string> };

export const idleState: FormState = { status: "idle" };

/** A test result as the UI shows it. Secrets are already removed. */
export type TestView =
  | {
      status: "done";
      ok: boolean;
      title: string;
      message: string;
    }
  | { status: "pick-provider"; message: string }
  | { status: "error"; message: string };

/** The masked secret as the UI shows it. Plain function: server and client code both use it. */
export function maskedSecret(stored: { hasSecret: boolean; last4: string | null }): string {
  if (!stored.hasSecret) return "No secret stored";
  return stored.last4 ? `•••• ${stored.last4}` : "Stored";
}

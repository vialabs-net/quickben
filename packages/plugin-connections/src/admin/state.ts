import type { ConnectionsT } from "./messages";

/**
 * The general message of a failed form: a domain message as given (from core or the plugin),
 * or a code the form translates.
 */
export type FormMessage =
  { text: string } | { code: "fixFields" } | { code: "unknownProvider"; type: string };

/** Result of a form action. Same shape as the admin's own forms. */
export type FormState =
  | { status: "idle" }
  | { status: "error"; message: FormMessage; fieldErrors: Record<string, string> };

export const idleState: FormState = { status: "idle" };

/** The text of a {@link FormMessage}. */
export function formMessage(t: ConnectionsT, message: FormMessage): string {
  if ("text" in message) return message.text;
  if (message.code === "unknownProvider") return t("error.unknownProvider", { type: message.type });
  return t("error.fixFields");
}

/**
 * A test result as the UI shows it. Secrets are already removed. `error` is the provider
 * tester's own text.
 */
export type TestView =
  | {
      status: "done";
      ok: boolean;
      subject: "connection" | "credential";
      model: string | null;
      latencyMs: number;
      error: string | null;
    }
  | { status: "pick-provider"; message: string }
  | { status: "error"; message: string };

/** Title and message of a finished test. */
export function testMessage(
  t: ConnectionsT,
  view: Extract<TestView, { status: "done" }>,
): { title: string; message: string } {
  const connection = view.subject === "connection";
  if (!view.ok) {
    return {
      title: t(connection ? "test.connectionFailed" : "test.credentialFailed"),
      message: view.error ?? t("test.noDetail"),
    };
  }
  const latency = view.latencyMs;
  return {
    title: t(connection ? "test.connectionWorks" : "test.credentialWorks"),
    message:
      view.model === null
        ? t("test.answered", { latency })
        : t("test.modelAnswered", { model: view.model, latency }),
  };
}

/** The masked secret as the UI shows it. Plain function: server and client code both use it. */
export function maskedSecret(
  stored: { hasSecret: boolean; last4: string | null },
  t: ConnectionsT,
): string {
  if (!stored.hasSecret) return t("secret.none");
  return stored.last4 ? `•••• ${stored.last4}` : t("secret.stored");
}

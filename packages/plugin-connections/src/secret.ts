import { lastFour } from "./crypto";
import { parseServiceAccount } from "./providers/google-auth";

import type { CredentialKind } from "./provider";

/** `true`, or why `secret` is not a valid secret of `kind`. */
export function checkSecret(kind: CredentialKind, secret: string): true | string {
  switch (kind) {
    case "service_account_json":
      return parseServiceAccount(secret)
        ? true
        : "Paste the whole JSON key of a service account (type, client_email, private_key).";
    case "basic": {
      const colon = secret.indexOf(":");
      return colon > 0 ? true : "Write it as username:password.";
    }
    default:
      return /\s/.test(secret.trim()) ? "An API key has no spaces." : true;
  }
}

/** What the UI may show of a secret: its last 4 characters (of the key id for a JSON key). */
export function secretLast4(kind: CredentialKind, secret: string): string {
  if (kind === "service_account_json")
    return lastFour(parseServiceAccount(secret)?.private_key_id ?? "");
  if (kind === "basic") return lastFour(secret.slice(secret.indexOf(":") + 1));
  return lastFour(secret);
}

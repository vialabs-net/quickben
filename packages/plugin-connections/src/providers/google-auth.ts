import { createSign } from "node:crypto";

import { z } from "zod";

import type { FetchLike } from "../provider";

/** Google's OAuth token endpoint. Fixed: the `token_uri` of an uploaded key is ignored. */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1).optional(),
  private_key_id: z.string().min(1).optional(),
  private_key: z.string().includes("PRIVATE KEY"),
  client_email: z.email(),
});

/** The fields of a Google service account key that the plugin uses. */
export type ServiceAccount = z.output<typeof serviceAccountSchema>;

/** Parse a service account key (JSON text). `undefined` when it is not one. */
export function parseServiceAccount(json: string): ServiceAccount | undefined {
  try {
    const parsed = serviceAccountSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** A signed JWT assertion for the OAuth JWT bearer grant (RFC 7523). */
export function serviceAccountAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(account.private_key_id ? { kid: account.private_key_id } : {}),
  };
  const claims = {
    iss: account.client_email,
    scope: CLOUD_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  return `${unsigned}.${base64url(signature)}`;
}

/**
 * Trade a service account key for an access token. Returns the token, or the HTTP status when
 * Google refuses the key.
 */
export async function serviceAccountToken(
  account: ServiceAccount,
  fetch: FetchLike,
  signal: AbortSignal,
  now: number = Date.now(),
): Promise<{ token: string } | { status: number }> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: serviceAccountAssertion(account, Math.floor(now / 1000)),
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
    signal,
  });
  if (!response.ok) return { status: response.status };
  const json = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  return typeof json?.access_token === "string" ? { token: json.access_token } : { status: 502 };
}

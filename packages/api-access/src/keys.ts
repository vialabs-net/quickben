import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface IssuedApiKey {
  /** Public id, 12 lowercase base36 characters. Store it and look keys up by it. */
  keyId: string;
  /** Random part. Show it once; never store it. */
  secret: string;
  /** `${prefix}_${keyId}_${secret}`. Give this to the client. */
  token: string;
  /** SHA-256 hex of `secret`. Store it. */
  secretHash: string;
  /** Last 4 characters of `secret`, to show in a key list. */
  hint: string;
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_ID_LENGTH = 12;
const SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 128;
const PREFIX = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?$/;
const KEY_ID = /^[0-9a-z]{12}$/;
const SECRET = new RegExp(`^[0-9A-Za-z]{${String(SECRET_LENGTH)},${String(MAX_SECRET_LENGTH)}}$`);
const HASH = /^[0-9a-f]{64}$/;

/** Random string over `alphabet`, with rejection sampling so every character is equally likely. */
function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += alphabet.charAt(byte % alphabet.length);
      if (out.length === length) break;
    }
  }
  return out;
}

function assertPrefix(prefix: string): void {
  if (!PREFIX.test(prefix)) {
    throw new TypeError(
      `Invalid API key prefix "${prefix}": use letters and digits, with at most one underscore.`,
    );
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Creates a new API key. Store `keyId`, `secretHash` and `hint`; give `token` to the client. */
export function createApiKey(opts: { prefix: string }): IssuedApiKey {
  assertPrefix(opts.prefix);
  const keyId = randomString(BASE36, KEY_ID_LENGTH);
  const secret = randomString(BASE62, SECRET_LENGTH);
  return {
    keyId,
    secret,
    token: `${opts.prefix}_${keyId}_${secret}`,
    secretHash: sha256Hex(secret),
    hint: secret.slice(-4),
  };
}

/** Splits a token into `keyId` and `secret`. Returns null when the token is malformed or has another prefix. */
export function parseApiKey(
  token: string,
  opts: { prefix: string },
): { keyId: string; secret: string } | null {
  assertPrefix(opts.prefix);
  const start = `${opts.prefix}_`;
  if (!token.startsWith(start)) return null;
  const rest = token.slice(start.length);
  const keyId = rest.slice(0, KEY_ID_LENGTH);
  const secret = rest.slice(KEY_ID_LENGTH + 1);
  if (rest.charAt(KEY_ID_LENGTH) !== "_" || !KEY_ID.test(keyId) || !SECRET.test(secret)) {
    return null;
  }
  return { keyId, secret };
}

/** Compares `secret` with a stored `secretHash` in constant time. */
export function verifyApiKeySecret(secret: string, secretHash: string): boolean {
  const expected = secretHash.toLowerCase();
  if (!HASH.test(expected)) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(secret), "hex"), Buffer.from(expected, "hex"));
}

/**
 * Reads the token from an `Authorization: Bearer <token>` header, else from a raw API key
 * header such as `X-API-Key`. Returns null when neither has a token.
 */
export function bearerToken(
  authorization: string | undefined,
  apiKeyHeader?: string,
): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization ?? "");
  if (match?.[1]) return match[1];
  const raw = apiKeyHeader?.trim() ?? "";
  return raw === "" ? null : raw;
}

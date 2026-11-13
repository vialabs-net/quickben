import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { ConfigError } from "@quickben/core";

/**
 * Secrets at rest: AES-256-GCM with a 32-byte master key. A sealed value is
 * `v1:<key id>:<iv>:<tag>:<ciphertext>` (base64 parts). The key id is the first 8 hex digits of
 * the SHA-256 of the key, so a value says which key sealed it and key rotation can keep old keys
 * for reading.
 */
const VERSION = "v1";

/** Binds a ciphertext to its use, so it cannot be replayed into another field. */
const AAD = Buffer.from("quickben:credential-secret");

/** A master key: 32 bytes, or a string with them in hex (64 digits) or base64. */
export type MasterKeyInput = string | Uint8Array;

/** A parsed master key. */
export interface MasterKey {
  readonly id: string;
  readonly key: Buffer;
}

/** The master key is missing, malformed or does not open a stored secret. */
export class MasterKeyError extends ConfigError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MasterKeyError";
  }
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** Parse a master key. Throws {@link MasterKeyError} unless it is exactly 32 bytes. */
export function parseMasterKey(input: MasterKeyInput): MasterKey {
  let key: Buffer;
  if (typeof input === "string") {
    const raw = input.trim();
    key = /^[\da-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  } else {
    key = Buffer.from(input);
  }
  if (key.length !== 32) {
    throw new MasterKeyError("The connections master key must be 32 bytes (hex or base64)");
  }
  return { id: keyId(key), key };
}

/** A new random master key, base64. Store it in a secret manager, not in the database. */
export function generateMasterKey(): string {
  return randomBytes(32).toString("base64");
}

/** Encrypt a secret with `key`. */
export function encryptSecret(plain: string, key: MasterKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    key.id,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(":");
}

/** The id of the key that sealed a value, or `undefined` for an unknown format. */
export function sealedKeyId(sealed: string): string | undefined {
  const [version, id] = sealed.split(":");
  return version === VERSION ? id : undefined;
}

/**
 * Decrypt a value sealed by {@link encryptSecret}, with whichever of `keys` sealed it. Throws
 * {@link MasterKeyError} when no key matches or the value was changed.
 */
export function decryptSecret(sealed: string, keys: readonly MasterKey[]): string {
  const [version, id, iv, tag, data, ...rest] = sealed.split(":");
  if (version !== VERSION || !id || !iv || !tag || data === undefined || rest.length > 0) {
    throw new MasterKeyError("Unknown secret format");
  }
  const key = keys.find((candidate) => candidate.id === id);
  if (!key) throw new MasterKeyError(`No master key with id ${id} is configured`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch (error) {
    throw new MasterKeyError("The secret cannot be decrypted with the master key", {
      cause: error,
    });
  }
}

/** The last 4 characters of a secret, as the UI shows them. Empty for 8 characters or less. */
export function lastFour(secret: string): string {
  const value = secret.trim();
  return value.length > 8 ? value.slice(-4) : "";
}

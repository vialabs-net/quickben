/** Text that replaces a removed secret. */
export const REDACTED = "[redacted]";

/**
 * A copy of `value` without the given keys, at any depth. Use it in a provider's
 * `redactResponse` for APIs that echo secrets in known fields:
 *
 * ```ts
 * redactResponse: (body) => redactKeys(body, ["organization_api_key"]),
 * ```
 */
export function redactKeys<T>(value: T, keys: Iterable<string>): T {
  const names = new Set(keys);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).flatMap(([key, child]) => (names.has(key) ? [] : [[key, walk(child)]])),
    );
  };
  return walk(value) as T;
}

/**
 * A copy of `value` where every string that contains one of `secrets` has it replaced with
 * {@link REDACTED}, at any depth (keys included). Secrets shorter than 4 characters are ignored:
 * they would match too much.
 */
export function redactSecrets<T>(value: T, secrets: Iterable<string>): T {
  const list = [...secrets].filter((secret) => secret.length >= 4);
  if (list.length === 0) return value;
  const scrub = (text: string) =>
    list.reduce((result, secret) => result.split(secret).join(REDACTED), text);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return scrub(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => [scrub(key), walk(child)]),
    );
  };
  return walk(value) as T;
}

/**
 * The strings of a secret worth hiding: the whole secret, plus its parts for kinds that hold
 * several (the password of `user:password`, the private key of a service account).
 */
export function secretVariants(secret: string): string[] {
  const variants = new Set([secret, secret.trim()]);
  const colon = secret.indexOf(":");
  if (colon > 0) variants.add(secret.slice(colon + 1));
  try {
    const parsed = JSON.parse(secret) as unknown;
    if (parsed && typeof parsed === "object") {
      for (const key of ["private_key", "private_key_id", "client_secret"]) {
        const part = (parsed as Record<string, unknown>)[key];
        if (typeof part === "string") variants.add(part);
      }
    }
  } catch {
    // Not JSON.
  }
  return [...variants];
}

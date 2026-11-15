import { z } from "zod";

/**
 * A module enabled for an organization: its key, or the key with an expiry and a source
 * (for example the plan that grants it). A plain key never expires.
 */
export type ModuleEntitlement =
  | string
  | {
      key: string;
      /** ISO datetime. From this moment the module counts as disabled. `null` = never. */
      expiresAt?: string | null;
      /** Where the entitlement comes from, e.g. a plan key. Informational. */
      source?: string | null;
    };

/** An entitlement in object form. */
export interface ModuleGrant {
  key: string;
  expiresAt: string | null;
  source: string | null;
}

/** Schema of `organization.modules`: keys and entitlement objects can be mixed. */
export const entitlementList = z.array(
  z.union([
    z.string().min(1),
    z
      .object({
        key: z.string().min(1),
        expiresAt: z.iso.datetime({ offset: true }).nullish(),
        source: z.string().min(1).nullish(),
      })
      .strict(),
  ]),
);

/** Object form of an entitlement. */
export function toGrant(entry: ModuleEntitlement): ModuleGrant {
  if (typeof entry === "string") return { key: entry, expiresAt: null, source: null };
  return { key: entry.key, expiresAt: entry.expiresAt ?? null, source: entry.source ?? null };
}

/**
 * The stored form: a plain key when there is no expiry or source, else an object with the
 * expiry in UTC. Lists of keys stay as they are, so stored data needs no migration.
 */
export function storeEntitlements(entries: readonly ModuleEntitlement[]): ModuleEntitlement[] {
  // A key or an object on purpose: the stored list stays a list of keys when nothing expires.
  // eslint-disable-next-line sonarjs/function-return-type
  return entries.map((entry): ModuleEntitlement => {
    const grant = toGrant(entry);
    if (grant.expiresAt === null && grant.source === null) return grant.key;
    return {
      key: grant.key,
      ...(grant.expiresAt === null ? {} : { expiresAt: new Date(grant.expiresAt).toISOString() }),
      ...(grant.source === null ? {} : { source: grant.source }),
    };
  });
}

/** Keys of every entitlement, expired or not. */
export function moduleKeys(entries: readonly ModuleEntitlement[] | undefined): string[] {
  return (entries ?? []).map((entry) => toGrant(entry).key);
}

/** Whether an entitlement has expired at `now`. */
export function isExpired(entry: ModuleEntitlement, now: Date = new Date()): boolean {
  const { expiresAt } = toGrant(entry);
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime();
}

/**
 * Keys of the modules an organization may use at `now`: listed and not expired.
 *
 * ```ts
 * activeModules(organization.modules); // ["sales"]
 * ```
 */
export function activeModules(
  entries: readonly ModuleEntitlement[] | undefined,
  now: Date = new Date(),
): string[] {
  return (entries ?? []).filter((entry) => !isExpired(entry, now)).map((e) => toGrant(e).key);
}

import { ConfigError } from "@quickben/core";

import { parseMasterKey } from "./crypto";
import { providerMap } from "./provider";
import { builtinProviders } from "./providers";

import type { MasterKey, MasterKeyInput } from "./crypto";
import type { AnyProvider, FetchLike } from "./provider";
import type { Quickben, QuickbenConfig, QuickbenUser } from "@quickben/core";

/** Slugs of the collections the plugin adds. */
export const CREDENTIALS = "credentials";
export const CONNECTIONS = "connections";

/** Options of `connections()`. */
export interface ConnectionsOptions {
  /**
   * 32 bytes (hex, base64 or bytes) that encrypt every stored secret, e.g.
   * `process.env.QUICKBEN_MASTER_KEY`. Without it everything can be listed, but no secret can be
   * stored or used. Keep it outside the database.
   */
  masterKey?: MasterKeyInput;
  /** Older keys, used only to read secrets they sealed. See `rotateMasterKey`. */
  previousMasterKeys?: readonly MasterKeyInput[];
  /** Your own providers. One with the type of a built-in replaces it. */
  providers?: readonly AnyProvider[];
  /** Register the built-in providers: all (`true`, the default), none, or the listed types. */
  builtins?: boolean | readonly string[];
  /** Who may create, change, delete and test. Default: users with the role `admin`. */
  canManage?: (user: QuickbenUser) => boolean;
  /**
   * Who may read connections and credentials (never secrets). Default: users who can manage,
   * and users with the role `staff`.
   */
  canRead?: (user: QuickbenUser) => boolean;
  /** Fetch used by the provider tests. Default: the global `fetch`. */
  fetch?: FetchLike;
  /** Milliseconds before a test gives up. Default 20 000. */
  testTimeoutMs?: number;
  /** Sidebar group of the two collections in the admin. Default `Integrations`. */
  group?: string;
}

/** Options after defaults are applied. Read them with `getConnectionsOptions(qb)`. */
export interface ResolvedConnections {
  /** The current key first, then the previous ones. Empty without a master key. */
  readonly keys: readonly MasterKey[];
  readonly providers: ReadonlyMap<string, AnyProvider>;
  readonly canManage: (user: QuickbenUser) => boolean;
  readonly canRead: (user: QuickbenUser) => boolean;
  readonly fetch: FetchLike;
  readonly testTimeoutMs: number;
  readonly group: string;
}

function hasRole(role: string): (user: QuickbenUser) => boolean {
  return (user) => user.roles?.includes(role) === true;
}

function blank(value: MasterKeyInput | undefined): value is undefined {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}

function builtins(option: ConnectionsOptions["builtins"]): readonly AnyProvider[] {
  if (option === false) return [];
  if (option === undefined || option === true) return builtinProviders;
  const known = new Set(builtinProviders.map((provider) => provider.type));
  for (const type of option) {
    if (!known.has(type)) throw new ConfigError(`connections: unknown built-in provider "${type}"`);
  }
  return builtinProviders.filter((provider) => option.includes(provider.type));
}

export function resolveOptions(options: ConnectionsOptions): ResolvedConnections {
  const previous = options.previousMasterKeys ?? [];
  if (blank(options.masterKey) && previous.length > 0) {
    throw new ConfigError("connections: previousMasterKeys needs a masterKey");
  }
  const keys = blank(options.masterKey)
    ? []
    : [options.masterKey, ...previous].map((key) => parseMasterKey(key));
  const canManage = options.canManage ?? hasRole("admin");
  const staff = hasRole("staff");
  const timeout = options.testTimeoutMs ?? 20_000;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new ConfigError("connections: testTimeoutMs must be a positive integer");
  }
  return {
    keys,
    providers: providerMap([...builtins(options.builtins), ...(options.providers ?? [])]),
    canManage,
    canRead: options.canRead ?? ((user) => canManage(user) || staff(user)),
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    testTimeoutMs: timeout,
    group: options.group ?? "Integrations",
  };
}

const registered = new WeakMap<QuickbenConfig, ResolvedConnections>();

export function register(config: QuickbenConfig, resolved: ResolvedConnections): void {
  registered.set(config, resolved);
}

/** Options of an instance. Throws `ConfigError` when the plugin is not installed. */
export function getConnectionsOptions(qb: Quickben): ResolvedConnections {
  const resolved = registered.get(qb.config);
  if (!resolved) throw new ConfigError("The connections plugin is not installed in this config");
  return resolved;
}

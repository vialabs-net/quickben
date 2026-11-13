import { ConfigError } from "@quickben/core";
import { z } from "zod";

/** What a credential holds. */
export type CredentialKind = "api_key" | "service_account_json" | "basic";

/** Every credential kind, in display order. */
export const CREDENTIAL_KINDS: readonly { kind: CredentialKind; label: string }[] = [
  { kind: "api_key", label: "API key" },
  { kind: "service_account_json", label: "Service account (JSON)" },
  { kind: "basic", label: "Username and password" },
];

/**
 * A provider mark: a URL or a `data:` URI per theme. `dark` falls back to `light`. `keyline`
 * says how much of its tile the mark fills: a round mark is drawn larger so it reads as big as
 * a square one.
 */
export interface ProviderLogo {
  readonly light: string;
  readonly dark?: string;
  readonly keyline?: "circle" | "square";
}

/** The credential a test or a call uses. The secret is clear text: server code only. */
export interface ResolvedSecret {
  readonly id: string;
  readonly kind: CredentialKind;
  readonly secret: string;
}

/** The fetch function the testers use. Pass your own in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Input of a provider test. */
export interface TestContext<M = Record<string, unknown>> {
  /** The connection's base URL, or the provider default. `null` when neither is set. */
  readonly baseUrl: string | null;
  /** Parsed metadata of the connection (provider defaults for a credential test). */
  readonly metadata: M;
  /** The credential, decrypted. `null` when the connection has none. */
  readonly credential: ResolvedSecret | null;
  /** A model to try, when the caller asked for one. */
  readonly model: string | undefined;
  readonly fetch: FetchLike;
  /** Aborts after the test timeout. Pass it to every request. */
  readonly signal: AbortSignal;
}

/**
 * Result of a provider test. `error` must be the tester's own text: provider messages can echo
 * secrets. `detail` is optional data for the UI; it goes through `redactResponse`.
 */
export interface TestResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The model that answered, for LLM providers. */
  readonly model?: string;
  readonly detail?: unknown;
}

/** Input of {@link defineProvider}. */
export interface ProviderDefinition<S extends z.ZodType = z.ZodType> {
  /** Stored in `connections.providerType`. Lowercase letters, digits, `_` and `-`. */
  readonly type: string;
  readonly label: string;
  /** Picker group, e.g. `AI models`. */
  readonly category: string;
  readonly description?: string;
  readonly logo?: ProviderLogo;
  /** What connections of this type can do, e.g. `llm`, `vision`. */
  readonly capabilities: readonly string[];
  /** Base URL rules. Default: optional, no default. */
  readonly baseUrl?: {
    readonly required?: boolean;
    readonly default?: string;
    readonly placeholder?: string;
  };
  /** Credential rules. Default: required, `api_key` only. */
  readonly credential?: {
    readonly required?: boolean;
    readonly kinds: readonly CredentialKind[];
  };
  /**
   * Zod schema of `connections.metadata` (non-secret settings). Defaults are filled on save.
   * The admin form is built from it: use `.meta({ title, description, placeholder })` for
   * labels and hints. Default: an empty object.
   */
  readonly fields?: S;
  /** The cheapest real call that proves the endpoint and the credential work. */
  // Method syntax on purpose: a provider with a specific schema is still an `AnyProvider`.
  test?(ctx: TestContext<z.output<S>>): Promise<TestResult>;
  /**
   * Remove secrets a provider echoes in its answers (for example its own API key) from a
   * value before it is stored, logged or returned. Runs on every test `detail`. The plugin also
   * replaces the credential's secret wherever it appears as text.
   */
  redactResponse?(body: unknown): unknown;
}

/** A provider after {@link defineProvider}: defaults applied. */
export interface Provider<S extends z.ZodType = z.ZodType> extends ProviderDefinition<S> {
  readonly description: string;
  readonly baseUrl: {
    readonly required: boolean;
    readonly default?: string;
    readonly placeholder?: string;
  };
  readonly credential: { readonly required: boolean; readonly kinds: readonly CredentialKind[] };
  readonly fields: S;
}

/** Any provider, for lists. */
export type AnyProvider = Provider;

const typePattern = /^[a-z][\d_a-z-]{0,59}$/;

/**
 * Define a provider type. Pass the result in `connections({ providers })`.
 *
 * ```ts
 * const acme = defineProvider({
 *   type: "acme",
 *   label: "Acme API",
 *   category: "Identity",
 *   capabilities: ["identity_verification"],
 *   fields: z.object({ level: z.coerce.number().int().min(0).max(3).default(1) }),
 *   test: async ({ baseUrl, credential, fetch, signal }) => { … },
 * });
 * ```
 */
export function defineProvider<S extends z.ZodType = z.ZodObject>(
  definition: ProviderDefinition<S>,
): Provider<S> {
  if (!typePattern.test(definition.type)) {
    throw new ConfigError(
      `Invalid provider type "${definition.type}". Use lowercase letters, digits, "_" and "-".`,
    );
  }
  const credential = definition.credential ?? { kinds: ["api_key"] as const };
  if (credential.kinds.length === 0) {
    throw new ConfigError(`Provider "${definition.type}" needs at least one credential kind`);
  }
  return {
    ...definition,
    description: definition.description ?? "",
    baseUrl: { required: false, ...definition.baseUrl },
    credential: { required: true, ...credential },
    fields: definition.fields ?? (z.object({}) as unknown as S),
  };
}

/** Providers by type. Later definitions replace earlier ones with the same type. */
export function providerMap(providers: readonly AnyProvider[]): ReadonlyMap<string, AnyProvider> {
  return new Map(providers.map((provider) => [provider.type, provider]));
}

/** Providers grouped by category, in first-seen order. */
export function providersByCategory<P extends { readonly category: string }>(
  providers: Iterable<P>,
): { category: string; providers: P[] }[] {
  const groups = new Map<string, P[]>();
  for (const provider of providers) {
    groups.set(provider.category, [...(groups.get(provider.category) ?? []), provider]);
  }
  return [...groups].map(([category, list]) => ({ category, providers: list }));
}

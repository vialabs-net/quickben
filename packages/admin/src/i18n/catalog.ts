import type { AdminMessage } from "@quickben/core";

/** Messages of one locale, by key. */
export type MessageCatalog = Readonly<Record<string, AdminMessage>>;

/** A catalog with every key of `K`. */
export type CompleteCatalog<K extends string> = Readonly<Record<K, AdminMessage>>;

/**
 * Messages of one namespace in every locale it ships. `en` is the reference: it has every key,
 * and other locales fall back to it.
 */
export interface MessageBundle<N extends string = string, K extends string = string> {
  readonly namespace: N;
  readonly locales: Readonly<Record<string, Readonly<Partial<Record<K, AdminMessage>>>>> & {
    readonly en: CompleteCatalog<K>;
  };
}

/** Message keys of a bundle. */
export type MessageKey<B> = B extends MessageBundle<string, infer K> ? K : never;

/** Full keys of a bundle, as used in `admin.messages` overrides: `namespace.key`. */
export type FullMessageKey<B> = B extends MessageBundle<infer N, infer K> ? `${N}.${K}` : never;

const namespacePattern = /^[a-z][a-z\d-]*$/;

/**
 * Define the messages of a namespace. English is required and gives the keys; every other
 * locale passed here must have the same keys (the type checks it, and so does
 * {@link missingMessages} at runtime).
 *
 * ```ts
 * export const messages = defineMessages("reports", {
 *   en: { title: "Reports", count: { one: "{count} report", other: "{count} reports" } },
 *   es: { title: "Informes", count: { one: "{count} informe", other: "{count} informes" } },
 * });
 * ```
 */
export function defineMessages<const N extends string, const E extends MessageCatalog>(
  namespace: N,
  locales: { readonly en: E } & Readonly<Record<string, CompleteCatalog<keyof E & string>>>,
): MessageBundle<N, keyof E & string> {
  if (!namespacePattern.test(namespace)) {
    throw new TypeError(`Invalid message namespace "${namespace}". Use lowercase letters and -.`);
  }
  return { namespace, locales };
}

/** A key missing from, or unknown to, one locale of a bundle. */
export interface MessageProblem {
  locale: string;
  key: string;
  problem: "missing" | "unknown" | "placeholders";
}

function placeholders(message: AdminMessage | undefined): Set<string> {
  const names = new Set<string>();
  if (message === undefined) return names;
  const texts = typeof message === "string" ? [message] : Object.values(message);
  for (const text of texts) {
    for (const match of text.matchAll(/\{(\w+)\}/g)) names.add(match[1] ?? "");
  }
  return names;
}

/** Whether `message` uses a placeholder that `reference` does not provide. */
function extraPlaceholders(message: AdminMessage | undefined, reference: AdminMessage): boolean {
  const known = placeholders(reference);
  return [...placeholders(message)].some((name) => !known.has(name));
}

/**
 * Check that every locale of a bundle has exactly the English keys, and uses no placeholder
 * that the English message does not have. Use it in a test: `expect(missingMessages(messages)).toEqual([])`.
 */
export function missingMessages(bundle: MessageBundle): MessageProblem[] {
  const reference = bundle.locales.en;
  const keys = Object.keys(reference);
  const problems: MessageProblem[] = [];
  for (const [locale, catalog] of Object.entries(bundle.locales)) {
    if (locale === "en") continue;
    const messages: Readonly<Record<string, AdminMessage | undefined>> = catalog;
    for (const key of keys) {
      if (!Object.hasOwn(messages, key)) problems.push({ locale, key, problem: "missing" });
      else if (extraPlaceholders(messages[key], reference[key] ?? "")) {
        problems.push({ locale, key, problem: "placeholders" });
      }
    }
    for (const key of Object.keys(messages)) {
      if (!Object.hasOwn(reference, key)) problems.push({ locale, key, problem: "unknown" });
    }
  }
  return problems;
}

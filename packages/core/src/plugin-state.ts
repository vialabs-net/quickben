import type { QuickbenConfig } from "./types";

/** Per-config state of a plugin. Made by {@link pluginState}. */
export interface PluginState<T> {
  /** Store the state of `config`. */
  set(config: QuickbenConfig, value: T): void;
  /** The state of `config`, or `undefined`. */
  get(config: QuickbenConfig): T | undefined;
}

/**
 * Per-config state for a plugin, kept on `globalThis` under `id`. Every copy of the plugin
 * module shares it, so lookups keep working after a dev hot reload re-runs the module while
 * the cached Quickben instance (and its config) stays the same. Use a stable `id`, such as the
 * package name.
 *
 * ```ts
 * const state = pluginState<Resolved>("@acme/plugin-x");
 * // onInit: (qb) => state.set(qb.config, resolved)
 * ```
 */
export function pluginState<T>(id: string): PluginState<T> {
  const key = Symbol.for(`quickben.plugin-state.${id}`);
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  const map = (): WeakMap<QuickbenConfig, T> => {
    store[key] ??= new WeakMap<QuickbenConfig, T>();
    return store[key] as WeakMap<QuickbenConfig, T>;
  };
  return {
    set(config, value) {
      map().set(config, value);
    },
    get(config) {
      return map().get(config);
    },
  };
}

import { connectionState } from "../api";

import { connectionsMessages } from "./messages";

import type { LastTest } from "../collections";
import type { AdminI18n, SearchParams } from "@quickben/admin";
import type { ListToolbarFilter } from "@quickben/admin/ui";

const states = ["active", "failed", "untested"] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Search text and filter values of a list page, from its URL. Unknown values are dropped. */
export function readFilters<K extends string>(
  searchParams: SearchParams,
  allowed: Readonly<Record<K, readonly string[]>>,
): { q: string; filters: Record<K, string> } {
  const filters = {} as Record<K, string>;
  for (const key of Object.keys(allowed) as K[]) {
    const value = first(searchParams[`filter.${key}`]);
    filters[key] = allowed[key].includes(value) ? value : "";
  }
  return { q: first(searchParams.q), filters };
}

/** Whether `name` contains the search text, ignoring case. */
export function matchesSearch(name: string, q: string): boolean {
  return q === "" || name.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}

/** Whether a filter value is unset or equals `value`. */
export function matchesFilter(filter: string, value: string): boolean {
  return filter === "" || filter === value;
}

/** The test states a list can be filtered by. */
export const stateValues: readonly string[] = states;

/** The state of a record from its last test. */
export function stateOf(lastTest: LastTest | null): string {
  return connectionState(lastTest);
}

/** The status filter of a list toolbar. */
export function stateFilter(value: string, i18n: AdminI18n): ListToolbarFilter {
  const { t } = i18n.scope(connectionsMessages);
  return {
    name: "filter.state",
    label: t("filter.state"),
    value,
    options: states.map((state) => ({ value: state, label: t(`state.${state}`) })),
  };
}

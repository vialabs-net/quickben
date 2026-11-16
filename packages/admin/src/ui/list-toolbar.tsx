import { Button, ButtonLink } from "./button";
import { Input, Label, Select } from "./input";

import type { AdminI18n } from "../i18n/translator";

/** A filter select of a {@link ListToolbar}. */
export interface ListToolbarFilter {
  /** Query parameter, e.g. `filter.enabled`. */
  name: string;
  label: string;
  /** Current value, `""` for any. */
  value: string;
  options: readonly { value: string; label: string }[];
}

/** Props of {@link ListToolbar}. */
export interface ListToolbarProps {
  /** URL the form submits to (`GET`): the list page. */
  action: string;
  /** Prefix of the control ids, unique on the page. */
  idPrefix: string;
  /** The search box, or `null` for none. Its query parameter is `q`. */
  search?: { label: string; value: string } | null;
  filters?: readonly ListToolbarFilter[];
  /** Query parameters to keep, such as the sort order. */
  hidden?: Readonly<Record<string, string>>;
  /** Link that clears search and filters. Shown when search or a filter is set. */
  clearHref?: string;
  i18n: AdminI18n;
}

/**
 * Search box and filter selects of a list page, as a `GET` form: the same toolbar as the
 * generic list view, for plugin and custom list pages. Read `q` and the filter parameters
 * from `searchParams` and filter the list yourself.
 */
export function ListToolbar({
  action,
  idPrefix,
  search = null,
  filters = [],
  hidden = {},
  clearHref,
  i18n,
}: Readonly<ListToolbarProps>) {
  if (!search && filters.length === 0) return null;
  const active = (search !== null && search.value !== "") || filters.some((f) => f.value !== "");
  return (
    <form
      method="get"
      action={action}
      role="search"
      className="qb:flex qb:flex-wrap qb:items-end qb:gap-3 qb:border-b qb:border-line qb:px-4 qb:py-3"
    >
      {search ? (
        <div className="qb:min-w-0 qb:flex-1 qb:basis-56 qb:space-y-1 qb:lg:max-w-sm">
          <Label htmlFor={`${idPrefix}-search`} className="qb:block qb:text-xs qb:text-fg-muted">
            {search.label}
          </Label>
          <Input
            id={`${idPrefix}-search`}
            type="search"
            name="q"
            defaultValue={search.value}
            placeholder={i18n.t("list.searchPlaceholder")}
          />
        </div>
      ) : null}
      {filters.map((filter) => {
        const id = `${idPrefix}-${filter.name.replaceAll(/[^\w-]/g, "-")}`;
        return (
          <div key={filter.name} className="qb:min-w-0 qb:space-y-1">
            <Label htmlFor={id} className="qb:block qb:text-xs qb:text-fg-muted">
              {filter.label}
            </Label>
            <Select id={id} name={filter.name} defaultValue={filter.value} className="qb:w-40">
              <option value="">{i18n.t("list.any")}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        );
      })}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="qb:flex qb:gap-2">
        <Button type="submit" variant="secondary">
          {i18n.t("list.apply")}
        </Button>
        {active && clearHref !== undefined ? (
          <ButtonLink href={clearHref} variant="ghost">
            {i18n.t("list.clear")}
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}

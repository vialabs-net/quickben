import Link from "next/link";

import { ButtonLink } from "../ui/button";
import { Card } from "../ui/card";

import { PageHeader } from "./panels";

import type { AdminI18n } from "../i18n/translator";
import type { NavGroup } from "../nav";
import type { CollectionMeta } from "@quickben/next";

/** Props of {@link Dashboard}. */
export interface DashboardProps {
  title: string;
  basePath: string;
  groups: NavGroup[];
  collections: ReadonlyMap<string, CollectionMeta>;
  /** Document count per collection slug. */
  counts: Readonly<Record<string, number>>;
  /**
   * Whether the config has collections the admin shows. Without any, an empty dashboard says
   * that nothing is set up yet instead of that the user has no access. Default `true`.
   */
  configured?: boolean;
  i18n: AdminI18n;
}

/** Overview of the collections the user can read, grouped like the sidebar. */
export function Dashboard({
  title,
  basePath,
  groups,
  collections,
  counts,
  configured = true,
  i18n,
}: Readonly<DashboardProps>) {
  const sections = groups
    .map((group) => ({
      label: group.label,
      items: group.links
        .map((link) => collections.get(link.key))
        .filter((collection) => collection !== undefined),
    }))
    .filter((section) => section.items.length > 0);
  return (
    <>
      <PageHeader title={title} description={i18n.t("dashboard.description")} />
      {sections.length === 0 ? (
        <p className="qb:text-sm qb:text-fg-muted">
          {configured ? i18n.t("dashboard.empty") : i18n.t("dashboard.unconfigured")}
        </p>
      ) : null}
      <div className="qb:space-y-8">
        {sections.map((section) => (
          <section key={section.label} aria-labelledby={`qb-section-${section.label}`}>
            <h2
              id={`qb-section-${section.label}`}
              className="qb:mb-3 qb:text-xs qb:font-semibold qb:tracking-wide qb:text-fg-muted qb:uppercase"
            >
              {section.label}
            </h2>
            <ul className="qb:grid qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3 qb:2xl:grid-cols-4">
              {section.items.map((collection) => (
                <li key={collection.slug}>
                  <Card className="qb-card-padding qb:flex qb:h-full qb:flex-col">
                    <div className="qb:flex qb:items-baseline qb:justify-between qb:gap-3">
                      <Link
                        href={`${basePath}/${collection.slug}`}
                        className="qb:font-medium qb:text-fg-heading qb:hover:underline"
                      >
                        {collection.labels.plural}
                      </Link>
                      <span className="qb:text-2xl qb:font-semibold qb:tabular-nums qb:text-fg-heading">
                        {i18n.number(counts[collection.slug] ?? 0)}
                      </span>
                    </div>
                    {collection.admin.description ? (
                      <p className="qb:mt-1 qb:text-sm qb:text-fg-muted">
                        {collection.admin.description}
                      </p>
                    ) : null}
                    {collection.access.create ? (
                      <div className="qb:mt-auto qb:pt-4">
                        <ButtonLink
                          href={`${basePath}/${collection.slug}/new`}
                          variant="secondary"
                          size="sm"
                        >
                          {i18n.t("list.new", { singular: i18n.lower(collection.labels.singular) })}
                        </ButtonLink>
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

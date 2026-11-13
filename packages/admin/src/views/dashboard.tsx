import Link from "next/link";

import { ButtonLink } from "../ui/button";
import { Card } from "../ui/card";

import { PageHeader } from "./panels";

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
}

/** Overview of the collections the user can read, grouped like the sidebar. */
export function Dashboard({
  title,
  basePath,
  groups,
  collections,
  counts,
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
      <PageHeader title={title} description="Collections you can access." />
      {sections.length === 0 ? (
        <p className="qb:text-sm qb:text-zinc-500">There is nothing you can access yet.</p>
      ) : null}
      <div className="qb:space-y-8">
        {sections.map((section) => (
          <section key={section.label} aria-labelledby={`qb-section-${section.label}`}>
            <h2
              id={`qb-section-${section.label}`}
              className="qb:mb-3 qb:text-xs qb:font-semibold qb:tracking-wide qb:text-zinc-500 qb:uppercase"
            >
              {section.label}
            </h2>
            <ul className="qb:grid qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3 qb:2xl:grid-cols-4">
              {section.items.map((collection) => (
                <li key={collection.slug}>
                  <Card className="qb:flex qb:h-full qb:flex-col qb:p-5">
                    <div className="qb:flex qb:items-baseline qb:justify-between qb:gap-3">
                      <Link
                        href={`${basePath}/${collection.slug}`}
                        className="qb:font-medium qb:text-zinc-900 qb:hover:underline"
                      >
                        {collection.labels.plural}
                      </Link>
                      <span className="qb:text-2xl qb:font-semibold qb:tabular-nums qb:text-zinc-900">
                        {counts[collection.slug] ?? 0}
                      </span>
                    </div>
                    {collection.admin.description ? (
                      <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">
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
                          New {collection.labels.singular.toLowerCase()}
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

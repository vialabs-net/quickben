import { createAdminPage } from "@quickben/admin";
import { createOrganizationSwitcher, tenancyAdmin } from "@quickben/plugin-tenancy/admin";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ORGANIZATION_PAGES, tenancyEnabled } from "@/lib/tenancy";
import config from "@/quickben.config";

import type { AdminPageProps } from "@quickben/admin";
import type { ReactElement } from "react";

type Props = Readonly<{
  params: Promise<{ organization: string; segments?: string[] }>;
  searchParams: AdminPageProps["searchParams"];
}>;

/** Where the switcher goes: the same page of the chosen organization. */
const organizationHref = (id: string) => `${ORGANIZATION_PAGES}/${encodeURIComponent(id)}/members`;

// One embedded admin per organization: its base path holds the organization id, which
// `tenancy({ activeOrganization })` reads from the URL (see proxy.ts).
interface OrganizationViews {
  Page: (props: Readonly<AdminPageProps>) => ReactElement;
  Switcher: ReturnType<typeof createOrganizationSwitcher>;
}

const admins = new Map<string, OrganizationViews>();

function adminFor(organization: string): OrganizationViews {
  let admin = admins.get(organization);
  if (!admin) {
    const basePath = `${ORGANIZATION_PAGES}/${encodeURIComponent(organization)}`;
    admin = {
      Page: createAdminPage(config, {
        basePath,
        chrome: "none",
        extensions: [tenancyAdmin(config, { basePath, organizationHref })],
      }),
      Switcher: createOrganizationSwitcher(config, { basePath, organizationHref }),
    };
    admins.set(organization, admin);
  }
  return admin;
}

async function OrganizationAdmin({ params, searchParams }: Props) {
  const { organization, segments } = await params;
  const { Page, Switcher } = adminFor(organization);
  return (
    <>
      <div style={{ maxWidth: "20rem", marginBottom: "1rem" }}>
        <Switcher />
      </div>
      <Page params={Promise.resolve({ segments })} searchParams={searchParams} />
    </>
  );
}

/** Host pages whose URL names the organization, e.g. `/orgs/<id>/members`. */
export default function OrganizationPage(props: Props) {
  if (!tenancyEnabled) notFound();
  return (
    <main className="qb-root" style={{ padding: "1.5rem" }}>
      <Suspense fallback={null}>
        <OrganizationAdmin {...props} />
      </Suspense>
    </main>
  );
}

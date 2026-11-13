import { Button } from "@quickben/admin/ui";
import { getQuickben, getRequestContext } from "@quickben/next";
import Link from "next/link";

import { listMyOrganizations, resolveTenant } from "../api";
import { ORGANIZATIONS } from "../options";
import { OrganizationError } from "../tenant";

import { switchOrganizationAction } from "./actions";
import { AutoSubmitSelect } from "./auto-submit";

import type { QuickbenConfig, Quickben, RequestContext } from "@quickben/core";

interface Choice {
  id: string;
  label: string;
}

async function choices(qb: Quickben, ctx: RequestContext, platform: boolean): Promise<Choice[]> {
  if (platform) {
    const all = await qb.find(ORGANIZATIONS, { sort: "name", limit: 200 }, ctx);
    return all.docs.map((org) => ({ id: org.id, label: String(org.name) }));
  }
  const mine = await listMyOrganizations(qb, ctx);
  return mine.map(({ organization, role }) => ({
    id: organization.id,
    label: `${organization.name} (${role})`,
  }));
}

/** Build the organization switcher shown at the top of the admin sidebar. */
export function createSwitcher(config: QuickbenConfig, key: string, basePath: string) {
  const action = switchOrganizationAction.bind(null, key);

  return async function OrganizationSwitcher() {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    if (!ctx.user) return null;
    let current: string | null = null;
    let platform = false;
    try {
      const tenant = await resolveTenant(qb, ctx);
      current = tenant.organizationId;
      platform = tenant.platform;
    } catch (error) {
      if (!(error instanceof OrganizationError)) throw error;
    }
    const options = await choices(qb, ctx, platform);
    if (options.length === 0 && !platform) {
      return (
        <p className="qb:px-2.5 qb:text-sm qb:text-zinc-500">
          No organization yet.{" "}
          <Link
            href={`${basePath}/organization`}
            className="qb:font-medium qb:text-zinc-900 qb:hover:underline"
          >
            Create one
          </Link>
        </p>
      );
    }
    return (
      <form action={action} className="qb:space-y-1.5 qb:px-2.5">
        <label
          htmlFor="qb-organization"
          className="qb:text-xs qb:font-semibold qb:tracking-wide qb:text-zinc-400 qb:uppercase"
        >
          Active organization
        </label>
        <AutoSubmitSelect
          key={current ?? "none"}
          id="qb-organization"
          name="organizationId"
          defaultValue={current ?? ""}
        >
          {current === null ? (
            <option value="">{platform ? "All organizations" : "Choose…"}</option>
          ) : null}
          {platform && current !== null ? <option value="">All organizations</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <noscript>
          <Button type="submit" size="sm" variant="secondary">
            Switch
          </Button>
        </noscript>
      </form>
    );
  };
}

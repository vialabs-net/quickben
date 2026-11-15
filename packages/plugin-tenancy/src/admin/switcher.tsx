import { getAdminI18n } from "@quickben/admin";
import { Button } from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { listMyOrganizations, resolveTenant } from "../api";
import { ORGANIZATIONS } from "../options";
import { OrganizationError } from "../tenant";

import { switchOrganizationAction } from "./actions";
import { AutoSubmitSelect } from "./auto-submit";
import { roleLabel, tenancyMessages } from "./messages";

import type { TenancyT } from "./messages";
import type { AdminI18n } from "@quickben/admin";
import type { QuickbenConfig, Quickben, RequestContext } from "@quickben/core";

interface Choice {
  id: string;
  label: string;
}

async function choices(
  qb: Quickben,
  ctx: RequestContext,
  platform: boolean,
  t: TenancyT,
): Promise<Choice[]> {
  if (platform) {
    const all = await qb.find(ORGANIZATIONS, { sort: "name", limit: 200 }, ctx);
    return all.docs.map((org) => ({ id: org.id, label: String(org.name) }));
  }
  const mine = await listMyOrganizations(qb, ctx);
  return mine.map(({ organization, role }) => ({
    id: organization.id,
    label: t("switcher.option", { name: organization.name, role: roleLabel(t, role) }),
  }));
}

/** Props of the organization switcher. */
export interface OrganizationSwitcherProps {
  /** Translator. Default: `getAdminI18n(config)` for the current request. */
  i18n?: AdminI18n;
}

/**
 * The organization switcher of a registered tenancy admin instance. `tenancyAdmin` shows it at
 * the top of the sidebar; {@link createOrganizationSwitcher} gives it to host layouts.
 */
export function createSwitcher(config: QuickbenConfig, key: string, basePath: string) {
  const action = switchOrganizationAction.bind(null, key);

  return async function OrganizationSwitcher({ i18n }: Readonly<OrganizationSwitcherProps>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    if (!ctx.user) return null;
    const t = (i18n ?? (await getAdminI18n(config))).scope(tenancyMessages).t;
    let current: string | null = null;
    let platform = false;
    try {
      const tenant = await resolveTenant(qb, ctx);
      current = tenant.organizationId;
      platform = tenant.platform;
    } catch (error) {
      if (!(error instanceof OrganizationError)) throw error;
    }
    const options = await choices(qb, ctx, platform, t);
    if (options.length === 0 && !platform) {
      return (
        <p className="qb:px-2.5 qb:text-sm qb:text-fg-muted">
          {t("switcher.empty")}{" "}
          <Link
            href={`${basePath}/organization`}
            className="qb:font-medium qb:text-fg qb:hover:underline"
          >
            {t("switcher.create")}
          </Link>
        </p>
      );
    }
    return (
      <form action={action} className="qb:space-y-1.5 qb:px-2.5">
        <label
          htmlFor="qb-organization"
          className="qb:text-xs qb:font-semibold qb:tracking-wide qb:text-fg-subtle qb:uppercase"
        >
          {t("switcher.label")}
        </label>
        <AutoSubmitSelect
          key={current ?? "none"}
          id="qb-organization"
          name="organizationId"
          defaultValue={current ?? ""}
        >
          {current === null ? (
            <option value="">{platform ? t("switcher.all") : t("switcher.choose")}</option>
          ) : null}
          {platform && current !== null ? <option value="">{t("switcher.all")}</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <noscript>
          <Button type="submit" size="sm" variant="secondary">
            {t("switcher.submit")}
          </Button>
        </noscript>
      </form>
    );
  };
}

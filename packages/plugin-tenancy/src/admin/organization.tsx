import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Input,
  Select,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";

import { isExpired, toGrant } from "../entitlements";
import { accessOf, getTenancy, ORGANIZATIONS } from "../options";

import { createOrganizationAction, updateOrganizationAction } from "./actions";
import { AddedFields, addedFields, addedForm, ownOrganizationFields } from "./fields";
import { organizationStatusLabel, tenancyMessages } from "./messages";
import { Feedback, Field, Heading, Notice, tenantOrMessage } from "./shared";

import type { ModuleEntitlement } from "../entitlements";
import type { OrganizationAccess, ResolvedTenancy } from "../options";
import type { OrganizationRecord, Tenant } from "../tenant";
import type { AddedForm } from "./fields";
import type { TenancyT } from "./messages";
import type { AdminI18n, AdminServerFunction, AdminText, PageProps } from "@quickben/admin";
import type { BadgeTone } from "@quickben/admin/ui";
import type { QuickbenConfig, QuickbenUser } from "@quickben/core";
import type { ComponentType, ReactNode } from "react";

/** Props of an organization settings section. */
export interface OrganizationSectionProps {
  /** The active organization. */
  organization: OrganizationRecord;
  /** The user inside it: role, capabilities, modules, platform staff. */
  tenant: Tenant;
  user: QuickbenUser | null;
  basePath: string;
  /** Path segments after the section key. */
  segments: string[];
  searchParams: PageProps["searchParams"];
  i18n: AdminI18n;
  serverFunction: AdminServerFunction;
}

/**
 * An extra section of the Organization settings page, shown as a tab at
 * `<basePath>/organization/<key>`. The component is a server component; it can render forms
 * with its own server actions.
 */
export interface OrganizationSection {
  /** Path segment of the tab. Lowercase letters, digits and `-`. */
  key: string;
  label: AdminText;
  component: ComponentType<OrganizationSectionProps>;
  /** Show the tab to this user. Default: everyone who can open the page. */
  visible?: (tenant: Tenant) => boolean;
}

const accessTone: Record<OrganizationAccess, BadgeTone> = {
  full: "green",
  limited: "amber",
  none: "red",
};

interface ModuleOption {
  key: string;
  label: string;
}

function entitlementNote(entry: ModuleEntitlement, t: TenancyT, i18n: AdminI18n): string | null {
  const { expiresAt } = toGrant(entry);
  if (expiresAt === null) return null;
  if (isExpired(entry)) return t("settings.moduleExpired");
  return t("settings.moduleUntil", { date: i18n.date(expiresAt) });
}

function ModuleBadges({
  organization,
  modules,
  t,
  i18n,
}: Readonly<{
  organization: OrganizationRecord;
  modules: readonly ModuleOption[];
  t: TenancyT;
  i18n: AdminI18n;
}>) {
  return organization.modules.map((entry) => {
    const { key } = toGrant(entry);
    const note = entitlementNote(entry, t, i18n);
    const label = modules.find((m) => m.key === key)?.label ?? key;
    return (
      <Badge key={key} tone={isExpired(entry) ? "red" : "neutral"}>
        {note === null ? label : `${label} (${note})`}
      </Badge>
    );
  });
}

function StaffControls({
  organization,
  tenancy,
  modules,
  t,
  i18n,
}: Readonly<{
  organization: OrganizationRecord;
  tenancy: ResolvedTenancy;
  modules: readonly ModuleOption[];
  t: TenancyT;
  i18n: AdminI18n;
}>) {
  const entries = new Map(organization.modules.map((entry) => [toGrant(entry).key, entry]));
  return (
    <>
      <Field label={t("settings.status")} htmlFor="qb-org-status">
        <Select id="qb-org-status" name="status" defaultValue={organization.status}>
          {tenancy.statuses.map((status) => (
            <option key={status.name} value={status.name}>
              {organizationStatusLabel(t, i18n, tenancy, status.name)}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="qb:space-y-1.5">
        <legend className="qb:text-sm qb:font-medium qb:text-fg">{t("settings.modules")}</legend>
        <div className="qb:flex qb:flex-wrap qb:gap-3">
          {modules.map((module) => {
            const entry = entries.get(module.key);
            const note = entry === undefined ? null : entitlementNote(entry, t, i18n);
            return (
              <label key={module.key} className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
                <Checkbox name="modules" value={module.key} defaultChecked={entry !== undefined} />
                {module.label}
                {note === null ? null : <span className="qb:text-fg-muted">({note})</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

interface SettingsFormProps {
  tenancy: ResolvedTenancy;
  organization: OrganizationRecord;
  tenant: Tenant;
  modules: readonly ModuleOption[];
  save: (formData: FormData) => Promise<void>;
  added: AddedForm | null;
  t: TenancyT;
  i18n: AdminI18n;
}

function SettingsForm({
  tenancy,
  organization,
  tenant,
  modules,
  save,
  added,
  t,
  i18n,
}: Readonly<SettingsFormProps>) {
  const canEdit = tenant.capabilities.includes("organization:manage");
  const level = accessOf(tenancy, organization.status, false);
  return (
    <Card>
      <CardHeader
        title={t("settings.title")}
        description={canEdit ? undefined : t("settings.readOnly")}
      />
      <CardBody>
        <form action={save} className="qb:space-y-4">
          <Field label={t("settings.name")} htmlFor="qb-org-name">
            <Input
              id="qb-org-name"
              name="name"
              defaultValue={organization.name}
              required
              disabled={!canEdit}
            />
          </Field>
          <Field label={t("settings.slug")} htmlFor="qb-org-slug">
            <Input id="qb-org-slug" defaultValue={organization.slug} disabled />
          </Field>
          {tenant.platform ? (
            <StaffControls
              organization={organization}
              tenancy={tenancy}
              modules={modules}
              t={t}
              i18n={i18n}
            />
          ) : (
            <div className="qb:space-y-1.5">
              <p className="qb:text-sm qb:font-medium qb:text-fg">
                {t("settings.statusAndModules")}
              </p>
              <p className="qb:flex qb:flex-wrap qb:gap-1">
                <Badge tone={accessTone[level]}>
                  {organizationStatusLabel(t, i18n, tenancy, organization.status)}
                </Badge>
                <ModuleBadges organization={organization} modules={modules} t={t} i18n={i18n} />
              </p>
              <p className="qb:text-xs qb:text-fg-muted">{t("settings.platformOnly")}</p>
            </div>
          )}
          {added ? <AddedFields form={added} doc={organization} readOnly={!canEdit} /> : null}
          {canEdit ? <Button type="submit">{t("settings.save")}</Button> : null}
        </form>
      </CardBody>
    </Card>
  );
}

function CreateForm({
  create,
  t,
}: Readonly<{ create: (formData: FormData) => Promise<void>; t: TenancyT }>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader title={t("create.title")} description={t("create.description")} />
      <CardBody>
        <form action={create} className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
          <Field label={t("settings.name")} htmlFor="qb-new-org-name">
            <Input id="qb-new-org-name" name="name" required />
          </Field>
          <Field label={t("settings.slug")} htmlFor="qb-new-org-slug">
            <Input
              id="qb-new-org-slug"
              name="slug"
              required
              placeholder={t("create.slugPlaceholder")}
            />
          </Field>
          <Button type="submit">{t("create.submit")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Tabs of the settings page: General, then the visible sections. */
function SectionTabs({
  sections,
  current,
  basePath,
  t,
  i18n,
}: Readonly<{
  sections: readonly OrganizationSection[];
  current: string | undefined;
  basePath: string;
  t: TenancyT;
  i18n: AdminI18n;
}>) {
  const tabs = [
    { key: undefined, label: t("settings.general"), href: `${basePath}/organization` },
    ...sections.map((section) => ({
      key: section.key,
      label: typeof section.label === "function" ? section.label(i18n) : i18n.text(section.label),
      href: `${basePath}/organization/${section.key}`,
    })),
  ];
  return (
    <nav aria-label={t("settings.sections")} className="qb:mb-6">
      <ul className="qb:flex qb:flex-wrap qb:gap-2">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.href}>
              <ButtonLink
                href={tab.href}
                size="sm"
                variant={active ? "secondary" : "ghost"}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </ButtonLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const sectionKey = /^[a-z][a-z\d-]{0,62}$/;

/** Check section keys: valid and unique. */
export function assertSections(sections: readonly OrganizationSection[]): void {
  const seen = new Set<string>();
  for (const section of sections) {
    if (!sectionKey.test(section.key)) {
      throw new TypeError(
        `Invalid organization section key "${section.key}". Use lowercase letters, digits and "-".`,
      );
    }
    if (seen.has(section.key)) {
      throw new TypeError(`Organization section "${section.key}" is registered twice`);
    }
    seen.add(section.key);
  }
}

/** Build the Organization settings page. */
export function createOrganizationPage(
  config: QuickbenConfig,
  key: string,
  sections: readonly OrganizationSection[] = [],
) {
  const save = updateOrganizationAction.bind(null, key);
  const create = createOrganizationAction.bind(null, key);

  return async function OrganizationPage(props: Readonly<PageProps>) {
    const { searchParams, i18n, basePath, serverFunction, segments } = props;
    const t = i18n.scope(tenancyMessages).t;
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const { tenant, message } = await tenantOrMessage(qb, ctx, t);
    const organization = tenant?.organization;
    const [current, ...rest] = segments;
    const visible = tenant ? sections.filter((s) => s.visible?.(tenant) ?? true) : [];
    const section = visible.find((s) => s.key === current);
    let body: ReactNode;
    if (!tenant || !organization) {
      body = <Notice>{message ?? t("notice.choose")}</Notice>;
    } else if (current !== undefined) {
      const Section = section?.component;
      body = Section ? (
        <Section
          organization={organization}
          tenant={tenant}
          user={ctx.user}
          basePath={basePath}
          segments={rest}
          searchParams={searchParams}
          i18n={i18n}
          serverFunction={serverFunction}
        />
      ) : (
        <Notice>{t("settings.unknownSection")}</Notice>
      );
    } else {
      const modules = qb.config.modules.map((module) => ({
        key: module.key,
        label: i18n.text(module.label),
      }));
      const meta = await addedFields(qb, ctx, ORGANIZATIONS, ownOrganizationFields, i18n.locale);
      const added = meta
        ? await addedForm(qb, ctx, meta, organization, { serverFunction, i18n, form: "settings" })
        : null;
      body = (
        <SettingsForm
          tenancy={getTenancy(qb)}
          organization={organization}
          tenant={tenant}
          modules={modules}
          save={save}
          added={added}
          t={t}
          i18n={i18n}
        />
      );
    }
    return (
      <>
        <Heading title={t("organization.title")} description={t("organization.description")} />
        {organization && visible.length > 0 ? (
          <SectionTabs sections={visible} current={current} basePath={basePath} t={t} i18n={i18n} />
        ) : null}
        {body}
        {ctx.user && current === undefined ? <CreateForm create={create} t={t} /> : null}
        <Feedback searchParams={searchParams} t={t} />
      </>
    );
  };
}

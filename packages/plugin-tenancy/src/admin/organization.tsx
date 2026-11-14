import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Input,
  Select,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";

import { createOrganizationAction, updateOrganizationAction } from "./actions";
import { statusLabel, tenancyMessages } from "./messages";
import { Feedback, Field, Heading, Notice, tenantOrMessage } from "./shared";

import type { OrganizationRecord, Tenant } from "../tenant";
import type { TenancyT } from "./messages";
import type { PageProps } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

function SettingsForm({
  organization,
  tenant,
  modules,
  save,
  t,
}: Readonly<{
  organization: OrganizationRecord;
  tenant: Tenant;
  modules: readonly { key: string; label: string }[];
  save: (formData: FormData) => Promise<void>;
  t: TenancyT;
}>) {
  const canEdit = tenant.capabilities.includes("organization:manage");
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
            <>
              <Field label={t("settings.status")} htmlFor="qb-org-status">
                <Select id="qb-org-status" name="status" defaultValue={organization.status}>
                  <option value="active">{statusLabel(t, "active")}</option>
                  <option value="suspended">{statusLabel(t, "suspended")}</option>
                </Select>
              </Field>
              <fieldset className="qb:space-y-1.5">
                <legend className="qb:text-sm qb:font-medium qb:text-fg">
                  {t("settings.modules")}
                </legend>
                <div className="qb:flex qb:flex-wrap qb:gap-3">
                  {modules.map((module) => (
                    <label key={module.key} className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
                      <Checkbox
                        name="modules"
                        value={module.key}
                        defaultChecked={organization.modules.includes(module.key)}
                      />
                      {module.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <div className="qb:space-y-1.5">
              <p className="qb:text-sm qb:font-medium qb:text-fg">
                {t("settings.statusAndModules")}
              </p>
              <p className="qb:flex qb:flex-wrap qb:gap-1">
                <Badge tone={organization.status === "active" ? "green" : "red"}>
                  {statusLabel(t, organization.status)}
                </Badge>
                {organization.modules.map((moduleKey) => (
                  <Badge key={moduleKey}>
                    {modules.find((m) => m.key === moduleKey)?.label ?? moduleKey}
                  </Badge>
                ))}
              </p>
              <p className="qb:text-xs qb:text-fg-muted">{t("settings.platformOnly")}</p>
            </div>
          )}
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

/** Build the Organization settings page. */
export function createOrganizationPage(config: QuickbenConfig, key: string) {
  const save = updateOrganizationAction.bind(null, key);
  const create = createOrganizationAction.bind(null, key);

  return async function OrganizationPage({ searchParams, i18n }: Readonly<PageProps>) {
    const t = i18n.scope(tenancyMessages).t;
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const { tenant, message } = await tenantOrMessage(qb, ctx, t);
    const modules = qb.config.modules.map((module) => ({
      key: module.key,
      label: i18n.text(module.label),
    }));
    return (
      <>
        <Heading title={t("organization.title")} description={t("organization.description")} />
        {tenant?.organization ? (
          <SettingsForm
            organization={tenant.organization}
            tenant={tenant}
            modules={modules}
            save={save}
            t={t}
          />
        ) : (
          <Notice>{message ?? t("notice.choose")}</Notice>
        )}
        {ctx.user ? <CreateForm create={create} t={t} /> : null}
        <Feedback searchParams={searchParams} t={t} />
      </>
    );
  };
}

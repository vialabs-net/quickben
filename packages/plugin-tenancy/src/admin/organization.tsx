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
import { getQuickben, getRequestContext } from "@quickben/next";

import { createOrganizationAction, updateOrganizationAction } from "./actions";
import { Feedback, Field, Heading, Notice, tenantOrMessage } from "./shared";

import type { OrganizationRecord, Tenant } from "../tenant";
import type { QuickbenConfig } from "@quickben/core";

type SearchParams = Record<string, string | string[] | undefined>;

function SettingsForm({
  organization,
  tenant,
  modules,
  save,
}: Readonly<{
  organization: OrganizationRecord;
  tenant: Tenant;
  modules: readonly { key: string; label: string }[];
  save: (formData: FormData) => Promise<void>;
}>) {
  const canEdit = tenant.capabilities.includes("organization:manage");
  return (
    <Card>
      <CardHeader
        title="Settings"
        description={canEdit ? undefined : "Your role cannot change these settings."}
      />
      <CardBody>
        <form action={save} className="qb:space-y-4">
          <Field label="Name" htmlFor="qb-org-name">
            <Input
              id="qb-org-name"
              name="name"
              defaultValue={organization.name}
              required
              disabled={!canEdit}
            />
          </Field>
          <Field label="Slug" htmlFor="qb-org-slug">
            <Input id="qb-org-slug" defaultValue={organization.slug} disabled />
          </Field>
          {tenant.platform ? (
            <>
              <Field label="Status" htmlFor="qb-org-status">
                <Select id="qb-org-status" name="status" defaultValue={organization.status}>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </Select>
              </Field>
              <fieldset className="qb:space-y-1.5">
                <legend className="qb:text-sm qb:font-medium qb:text-zinc-900">Modules</legend>
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
              <p className="qb:text-sm qb:font-medium qb:text-zinc-900">Status and modules</p>
              <p className="qb:flex qb:flex-wrap qb:gap-1">
                <Badge tone={organization.status === "active" ? "green" : "red"}>
                  {organization.status}
                </Badge>
                {organization.modules.map((moduleKey) => (
                  <Badge key={moduleKey}>
                    {modules.find((m) => m.key === moduleKey)?.label ?? moduleKey}
                  </Badge>
                ))}
              </p>
              <p className="qb:text-xs qb:text-zinc-500">Set by platform staff.</p>
            </div>
          )}
          {canEdit ? <Button type="submit">Save settings</Button> : null}
        </form>
      </CardBody>
    </Card>
  );
}

function CreateForm({ create }: Readonly<{ create: (formData: FormData) => Promise<void> }>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader title="New organization" description="You become its owner." />
      <CardBody>
        <form action={create} className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
          <Field label="Name" htmlFor="qb-new-org-name">
            <Input id="qb-new-org-name" name="name" required />
          </Field>
          <Field label="Slug" htmlFor="qb-new-org-slug">
            <Input id="qb-new-org-slug" name="slug" required placeholder="acme-inc" />
          </Field>
          <Button type="submit">Create organization</Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Build the Organization settings page. */
export function createOrganizationPage(config: QuickbenConfig, key: string) {
  const save = updateOrganizationAction.bind(null, key);
  const create = createOrganizationAction.bind(null, key);

  return async function OrganizationPage({
    searchParams,
  }: Readonly<{ searchParams: SearchParams }>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const { tenant, message } = await tenantOrMessage(qb, ctx);
    const modules = qb.config.modules.map((module) => ({ key: module.key, label: module.label }));
    return (
      <>
        <Heading
          title="Organization"
          description="Name, status and modules of the active organization."
        />
        {tenant?.organization ? (
          <SettingsForm
            organization={tenant.organization}
            tenant={tenant}
            modules={modules}
            save={save}
          />
        ) : (
          <Notice>{message ?? "Choose an organization in the sidebar."}</Notice>
        )}
        {ctx.user ? <CreateForm create={create} /> : null}
        <Feedback searchParams={searchParams} />
      </>
    );
  };
}

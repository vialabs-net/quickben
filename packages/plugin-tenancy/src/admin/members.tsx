import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Input,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";

import { MEMBERSHIPS, getTenancy } from "../options";

import { inviteMemberAction, removeMemberAction, updateMemberAction } from "./actions";
import { roleLabel, statusLabel, tenancyMessages } from "./messages";
import { Feedback, Field, Heading, Notice, tenantOrMessage } from "./shared";

import type { MembershipRecord, Tenant } from "../tenant";
import type { TenancyT } from "./messages";
import type { PageProps } from "@quickben/admin";
import type { BadgeTone } from "@quickben/admin/ui";
import type { QuickbenConfig } from "@quickben/core";

const statuses = ["invited", "active", "disabled"] as const;
const statusTone: Record<string, BadgeTone> = { active: "green", invited: "blue", disabled: "red" };

function moduleLabel(modules: readonly { key: string; label: string }[], key: string): string {
  return modules.find((module) => module.key === key)?.label ?? key;
}

interface RowProps {
  membership: MembershipRecord;
  tenant: Tenant;
  roles: readonly string[];
  modules: readonly { key: string; label: string }[];
  canManage: boolean;
  update: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
  t: TenancyT;
}

function MemberRow({
  membership,
  tenant,
  roles,
  modules,
  canManage,
  update,
  remove,
  t,
}: Readonly<RowProps>) {
  const formId = `qb-member-${membership.id}`;
  const self = tenant.membership?.id === membership.id;
  // Owners and admins cannot change their own role or status (a guard rail of the plugin).
  const locked = self && tenant.capabilities.includes("members:manage");
  const who = membership.email ?? membership.user ?? membership.id;
  return (
    <Tr>
      <Td>
        <span className="qb:font-medium qb:text-fg">{who}</span>
        {self ? <span className="qb:text-fg-muted"> {t("members.you")}</span> : null}
        {membership.email && membership.user ? (
          <p className="qb:text-xs qb:text-fg-muted">{membership.user}</p>
        ) : null}
      </Td>
      <Td>
        {canManage ? (
          <Select
            form={formId}
            name="role"
            defaultValue={membership.role}
            disabled={locked}
            aria-label={t("members.roleOf", { who })}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(t, role)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge>{roleLabel(t, membership.role)}</Badge>
        )}
      </Td>
      <Td>
        {canManage ? (
          <Select
            form={formId}
            name="status"
            defaultValue={membership.status}
            disabled={locked}
            aria-label={t("members.statusOf", { who })}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(t, status)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={statusTone[membership.status] ?? "neutral"}>
            {" "}
            {statusLabel(t, membership.status)}
          </Badge>
        )}
      </Td>
      <Td>
        {canManage ? (
          <fieldset className="qb:flex qb:flex-wrap qb:gap-3">
            <legend className="qb:sr-only">{t("members.modulesOf", { who })}</legend>
            {modules.map((module) => (
              <label key={module.key} className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
                <Checkbox
                  form={formId}
                  name="modules"
                  value={module.key}
                  defaultChecked={membership.modules.includes(module.key)}
                />
                {module.label}
              </label>
            ))}
          </fieldset>
        ) : (
          <span className="qb:text-sm qb:text-fg-muted">
            {membership.modules.length === 0
              ? t("members.allModules")
              : membership.modules.map((key) => moduleLabel(modules, key)).join(", ")}
          </span>
        )}
      </Td>
      {canManage ? (
        <Td>
          <div className="qb:flex qb:gap-2">
            <form id={formId} action={update}>
              <input type="hidden" name="membershipId" value={membership.id} />
              <Button type="submit" size="sm" variant="secondary">
                {t("members.save")}
              </Button>
            </form>
            <form action={remove}>
              <input type="hidden" name="membershipId" value={membership.id} />
              <Button
                type="submit"
                size="sm"
                variant="danger"
                aria-label={t("members.removeWho", { who })}
              >
                {t("members.remove")}
              </Button>
            </form>
          </div>
        </Td>
      ) : null}
    </Tr>
  );
}

function InviteForm({
  roles,
  defaultRole,
  invite,
  t,
}: Readonly<{
  roles: readonly string[];
  defaultRole: string;
  invite: (formData: FormData) => Promise<void>;
  t: TenancyT;
}>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader title={t("invite.title")} description={t("invite.description")} />
      <CardBody>
        <form action={invite} className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
          <Field label={t("invite.invitee")} htmlFor="qb-invitee">
            <Input id="qb-invitee" name="invitee" required />
          </Field>
          <Field label={t("invite.role")} htmlFor="qb-invite-role">
            <Select id="qb-invite-role" name="role" defaultValue={defaultRole}>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(t, role)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">{t("invite.submit")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Build the Members page. */
export function createMembersPage(config: QuickbenConfig, key: string) {
  const update = updateMemberAction.bind(null, key);
  const remove = removeMemberAction.bind(null, key);
  const invite = inviteMemberAction.bind(null, key);

  return async function MembersPage({ searchParams, i18n }: Readonly<PageProps>) {
    const t = i18n.scope(tenancyMessages).t;
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const { tenant, message } = await tenantOrMessage(qb, ctx, t);
    const feedback = <Feedback searchParams={searchParams} t={t} />;
    if (!tenant?.organization) {
      return (
        <>
          <Heading title={t("members.title")} description={t("members.description")} />
          <Notice>{message ?? t("notice.choose")}</Notice>
          {feedback}
        </>
      );
    }
    const tenancy = getTenancy(qb);
    const roles = tenancy.roles.map((role) => role.name);
    const labels = new Map(qb.config.modules.map((module) => [module.key, module.label]));
    const modules = tenant.organization.modules.map((moduleKey) => ({
      key: moduleKey,
      label: i18n.text(labels.get(moduleKey) ?? moduleKey),
    }));
    const canManage = tenant.capabilities.includes("members:manage");
    const page = await qb.find(
      MEMBERSHIPS,
      { where: { organization: { eq: tenant.organization.id } }, sort: "email", limit: 500 },
      ctx,
    );
    return (
      <>
        <Heading
          title={t("members.title")}
          description={t("members.descriptionOf", { organization: tenant.organization.name })}
        />
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>{t("members.column.member")}</Th>
                <Th>{t("members.column.role")}</Th>
                <Th>{t("members.column.status")}</Th>
                <Th>{t("members.column.modules")}</Th>
                {canManage ? <Th>{t("members.column.actions")}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {page.docs.map((doc) => (
                <MemberRow
                  key={doc.id}
                  membership={doc as unknown as MembershipRecord}
                  tenant={tenant}
                  roles={roles}
                  modules={modules}
                  canManage={canManage}
                  update={update}
                  remove={remove}
                  t={t}
                />
              ))}
            </tbody>
          </Table>
        </Card>
        {canManage ? (
          <InviteForm roles={roles} defaultRole={tenancy.defaultRole} invite={invite} t={t} />
        ) : null}
        {feedback}
      </>
    );
  };
}

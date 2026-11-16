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

import { memberManager } from "../api";
import { isExpired, moduleKeys } from "../entitlements";
import { ALL_MODULES, MEMBERSHIPS, getTenancy } from "../options";

import {
  inviteMemberAction,
  removeMemberAction,
  updateMemberAction,
  updateMemberDetailsAction,
} from "./actions";
import { AddedFields, addedFields, addedForm, ownMembershipFields } from "./fields";
import { roleLabel, statusLabel, tenancyMessages } from "./messages";
import { Feedback, Field, Heading, hookNotice, Notice, tenantOrMessage } from "./shared";

import type { EmptyModules } from "../options";
import type { MembershipRecord, Tenant } from "../tenant";
import type { AddedForm } from "./fields";
import type { TenancyT } from "./messages";
import type { PageProps } from "@quickben/admin";
import type { BadgeTone } from "@quickben/admin/ui";
import type { QuickbenConfig } from "@quickben/core";

const statuses = ["invited", "active", "disabled"] as const;
const statusTone: Record<string, BadgeTone> = { active: "green", invited: "blue", disabled: "red" };

function moduleLabel(modules: readonly { key: string; label: string }[], key: string): string {
  return modules.find((module) => module.key === key)?.label ?? key;
}

/** Invoker command attributes (`commandfor`, `command`): open and close a dialog without JS. */
function invoke(target: string, command: "show-modal" | "close"): Record<string, string> {
  return { commandfor: target, command };
}

/** What the details dialog of a row needs. */
interface DetailsProps {
  form: AddedForm;
  save: (formData: FormData) => Promise<void>;
}

/** A button and a modal dialog with the fields a host added to memberships. */
function MemberDetails({
  membership,
  who,
  canManage,
  details,
  t,
}: Readonly<{
  membership: MembershipRecord;
  who: string;
  canManage: boolean;
  details: DetailsProps;
  t: TenancyT;
}>) {
  const dialogId = `qb-member-details-${membership.id}`;
  const titleId = `${dialogId}-title`;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={t("members.detailsOf", { who })}
        {...invoke(dialogId, "show-modal")}
      >
        {t("members.details")}
      </Button>
      <dialog
        id={dialogId}
        aria-labelledby={titleId}
        {...{ closedby: "any" }}
        className="qb:w-full qb:max-w-xl qb:rounded-lg qb:border qb:border-line qb:bg-surface qb:p-5 qb:text-fg qb:shadow-lg"
        style={{ margin: "auto" }}
      >
        <form action={details.save} className="qb:space-y-4">
          <h2 id={titleId} className="qb:text-lg qb:font-semibold">
            {t("members.detailsOf", { who })}
          </h2>
          <input type="hidden" name="membershipId" value={membership.id} />
          <AddedFields form={details.form} doc={membership} readOnly={!canManage} />
          <div className="qb:flex qb:gap-2">
            {canManage ? <Button type="submit">{t("members.saveDetails")}</Button> : null}
            <Button type="button" variant="ghost" {...invoke(dialogId, "close")}>
              {t("members.close")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** The modules a membership grants, as read-only text. */
function modulesText(
  t: TenancyT,
  modules: readonly { key: string; label: string }[],
  granted: readonly string[],
  emptyModules: EmptyModules,
): string {
  if (granted.includes(ALL_MODULES)) return t("members.allModules");
  if (granted.length === 0) {
    return emptyModules === "all" ? t("members.allModules") : t("members.noModules");
  }
  return granted.map((key) => moduleLabel(modules, key)).join(", ");
}

interface RowProps {
  membership: MembershipRecord;
  tenant: Tenant;
  roles: readonly string[];
  modules: readonly { key: string; label: string }[];
  /** What an empty `modules` list grants (`tenancy({ emptyModules })`). */
  emptyModules: EmptyModules;
  /** The user may change and remove this member (`members:manage` and `canManageMember`). */
  canManage: boolean;
  /** The user may remove this member. */
  canRemove: boolean;
  /** The table has an Actions column (the user has `members:manage`). */
  actionsColumn: boolean;
  update: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
  /** Set when hosts added fields to memberships. */
  details: DetailsProps | null;
  t: TenancyT;
}

function MemberRow({
  membership,
  tenant,
  roles,
  modules,
  emptyModules,
  canManage,
  canRemove,
  actionsColumn,
  update,
  remove,
  details,
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
            {emptyModules === "none" ? (
              <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
                <Checkbox
                  form={formId}
                  name="modules"
                  value={ALL_MODULES}
                  defaultChecked={membership.modules.includes(ALL_MODULES)}
                />
                {t("members.everyModule")}
              </label>
            ) : null}
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
            {modulesText(t, modules, membership.modules, emptyModules)}
          </span>
        )}
      </Td>
      {details ? (
        <Td>
          <MemberDetails
            membership={membership}
            who={who}
            canManage={canManage}
            details={details}
            t={t}
          />
        </Td>
      ) : null}
      {actionsColumn ? (
        <Td>
          <div className="qb:flex qb:gap-2">
            {canManage ? (
              <form id={formId} action={update}>
                <input type="hidden" name="membershipId" value={membership.id} />
                <Button type="submit" size="sm" variant="secondary">
                  {t("members.save")}
                </Button>
              </form>
            ) : null}
            {canRemove ? (
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
            ) : null}
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
  const saveDetails = updateMemberDetailsAction.bind(null, key);

  return async function MembersPage({ searchParams, i18n, serverFunction }: Readonly<PageProps>) {
    const t = i18n.scope(tenancyMessages).t;
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const { tenant, message } = await tenantOrMessage(qb, ctx, t);
    const notice = await hookNotice(searchParams);
    const feedback = <Feedback searchParams={searchParams} t={t} notice={notice} />;
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
    // Expired modules stay in the list, so saving a member keeps their grants as they are.
    const expired = new Set(
      tenant.organization.modules
        .filter((entry) => isExpired(entry))
        .flatMap((e) => moduleKeys([e])),
    );
    const modules = moduleKeys(tenant.organization.modules).map((moduleKey) => {
      const label = i18n.text(labels.get(moduleKey) ?? moduleKey);
      return {
        key: moduleKey,
        label: expired.has(moduleKey) ? `${label} (${t("settings.moduleExpired")})` : label,
      };
    });
    const canManage = tenant.capabilities.includes("members:manage");
    const page = await qb.find(
      MEMBERSHIPS,
      { where: { organization: { eq: tenant.organization.id } }, sort: "email", limit: 500 },
      ctx,
    );
    // Policies see stored fields; rendering still uses the access-filtered page.
    const check = await memberManager(
      qb,
      ctx,
      tenant.organization.id,
      page.docs.map((doc) => doc.id),
    );
    const allowed = new Map(
      canManage
        ? await Promise.all(
            page.docs.map(async (doc) => {
              const membership = doc as unknown as MembershipRecord;
              const [update, remove] = await Promise.all([
                check(membership, "update"),
                check(membership, "remove"),
              ]);
              return [doc.id, { update, remove }] as const;
            }),
          )
        : [],
    );
    const added = await addedFields(qb, ctx, MEMBERSHIPS, ownMembershipFields, i18n.locale);
    const forms = new Map<string, AddedForm>(
      added
        ? await Promise.all(
            page.docs.map(
              async (doc) =>
                [
                  doc.id,
                  await addedForm(qb, ctx, added, doc, { serverFunction, i18n, form: "details" }),
                ] as const,
            ),
          )
        : [],
    );
    const detailsOf = (id: string): DetailsProps | null => {
      const form = forms.get(id);
      return form ? { form, save: saveDetails } : null;
    };
    return (
      <>
        <Heading
          title={t("members.title")}
          description={t(
            tenancy.emptyModules === "none" ? "members.descriptionNone" : "members.descriptionOf",
            { organization: tenant.organization.name },
          )}
        />
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>{t("members.column.member")}</Th>
                <Th>{t("members.column.role")}</Th>
                <Th>{t("members.column.status")}</Th>
                <Th>{t("members.column.modules")}</Th>
                {added ? <Th>{t("members.column.details")}</Th> : null}
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
                  emptyModules={tenancy.emptyModules}
                  canManage={allowed.get(doc.id)?.update ?? false}
                  canRemove={allowed.get(doc.id)?.remove ?? false}
                  actionsColumn={canManage}
                  update={update}
                  remove={remove}
                  details={detailsOf(doc.id)}
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

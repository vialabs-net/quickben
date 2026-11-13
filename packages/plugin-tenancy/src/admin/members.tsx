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
import { getQuickben, getRequestContext } from "@quickben/next";

import { MEMBERSHIPS, getTenancy } from "../options";

import { inviteMemberAction, removeMemberAction, updateMemberAction } from "./actions";
import { Feedback, Field, Heading, Notice, tenantOrMessage } from "./shared";

import type { MembershipRecord, Tenant } from "../tenant";
import type { BadgeTone } from "@quickben/admin/ui";
import type { QuickbenConfig } from "@quickben/core";

type SearchParams = Record<string, string | string[] | undefined>;

const statuses = ["invited", "active", "disabled"] as const;
const statusTone: Record<string, BadgeTone> = { active: "green", invited: "blue", disabled: "red" };

interface RowProps {
  membership: MembershipRecord;
  tenant: Tenant;
  roles: readonly string[];
  modules: readonly { key: string; label: string }[];
  canManage: boolean;
  update: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
}

function MemberRow({
  membership,
  tenant,
  roles,
  modules,
  canManage,
  update,
  remove,
}: Readonly<RowProps>) {
  const formId = `qb-member-${membership.id}`;
  const self = tenant.membership?.id === membership.id;
  const who = membership.email ?? membership.user ?? membership.id;
  return (
    <Tr>
      <Td>
        <span className="qb:font-medium qb:text-zinc-900">{who}</span>
        {self ? <span className="qb:text-zinc-500"> (you)</span> : null}
        {membership.email && membership.user ? (
          <p className="qb:text-xs qb:text-zinc-500">{membership.user}</p>
        ) : null}
      </Td>
      <Td>
        {canManage ? (
          <Select
            form={formId}
            name="role"
            defaultValue={membership.role}
            aria-label={`Role of ${who}`}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        ) : (
          <Badge>{membership.role}</Badge>
        )}
      </Td>
      <Td>
        {canManage ? (
          <Select
            form={formId}
            name="status"
            defaultValue={membership.status}
            aria-label={`Status of ${who}`}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={statusTone[membership.status] ?? "neutral"}>{membership.status}</Badge>
        )}
      </Td>
      <Td>
        {canManage ? (
          <fieldset className="qb:flex qb:flex-wrap qb:gap-3">
            <legend className="qb:sr-only">Modules of {who}</legend>
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
          <span className="qb:text-sm qb:text-zinc-500">
            {membership.modules.length === 0 ? "All" : membership.modules.join(", ")}
          </span>
        )}
      </Td>
      {canManage ? (
        <Td>
          <div className="qb:flex qb:gap-2">
            <form id={formId} action={update}>
              <input type="hidden" name="membershipId" value={membership.id} />
              <Button type="submit" size="sm" variant="secondary">
                Save
              </Button>
            </form>
            <form action={remove}>
              <input type="hidden" name="membershipId" value={membership.id} />
              <Button type="submit" size="sm" variant="danger" aria-label={`Remove ${who}`}>
                Remove
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
}: Readonly<{
  roles: readonly string[];
  defaultRole: string;
  invite: (formData: FormData) => Promise<void>;
}>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader
        title="Invite a member"
        description="An email address or a user id. The invitation is pending until they accept it."
      />
      <CardBody>
        <form action={invite} className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
          <Field label="Email or user id" htmlFor="qb-invitee">
            <Input id="qb-invitee" name="invitee" required />
          </Field>
          <Field label="Role" htmlFor="qb-invite-role">
            <Select id="qb-invite-role" name="role" defaultValue={defaultRole}>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Invite</Button>
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

  return async function MembersPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const { tenant, message } = await tenantOrMessage(qb, ctx);
    const feedback = <Feedback searchParams={searchParams} />;
    if (!tenant?.organization) {
      return (
        <>
          <Heading title="Members" description="People in the active organization." />
          <Notice>{message ?? "Choose an organization in the sidebar."}</Notice>
          {feedback}
        </>
      );
    }
    const tenancy = getTenancy(qb);
    const roles = tenancy.roles.map((role) => role.name);
    const labels = new Map(qb.config.modules.map((module) => [module.key, module.label]));
    const modules = tenant.organization.modules.map((moduleKey) => ({
      key: moduleKey,
      label: labels.get(moduleKey) ?? moduleKey,
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
          title="Members"
          description={`People in ${tenant.organization.name}. No module ticked means every module of the organization.`}
        />
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Modules</Th>
                {canManage ? <Th>Actions</Th> : null}
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
                />
              ))}
            </tbody>
          </Table>
        </Card>
        {canManage ? (
          <InviteForm roles={roles} defaultRole={tenancy.defaultRole} invite={invite} />
        ) : null}
        {feedback}
      </>
    );
  };
}

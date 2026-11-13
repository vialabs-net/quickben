import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Table,
  Td,
  Th,
  Tr,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { CONNECTIONS, CREDENTIALS, getConnectionsOptions } from "../options";
import { CREDENTIAL_KINDS } from "../provider";

import { deleteAction, saveCredentialAction, testCredentialAction } from "./actions";
import { CredentialForm } from "./credential-form";
import { DeleteButton } from "./delete-button";
import { kindLabel } from "./describe";
import { Detail, formatDatetime, LastTestDetails, PageHeader, TestBadge } from "./shared";
import { maskedSecret } from "./state";
import { TestCredentialButton } from "./test-button";

import type { ConnectionRecord, CredentialRecord } from "../api";
import type { ViewProps } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

async function load(config: QuickbenConfig) {
  const ctx = await getRequestContext(config);
  const qb = await getQuickben(config);
  return { qb, ctx, options: getConnectionsOptions(qb) };
}

function usedBy(count: number): string {
  if (count === 0) return "Unused";
  return count === 1 ? "1 connection" : `${String(count)} connections`;
}

function secretText(credential: CredentialRecord): string {
  return maskedSecret({ hasSecret: credential.hasSecret === true, last4: credential.last4 });
}

/** The list of credentials, with how many connections use each one. */
export function createCredentialsList(config: QuickbenConfig) {
  return async function CredentialsList({ collection, basePath }: Readonly<ViewProps>) {
    const { qb, ctx } = await load(config);
    const [credentials, connections] = await Promise.all([
      qb.find(CREDENTIALS, { sort: ["name"], limit: 500 }, ctx),
      qb.find(CONNECTIONS, { select: ["credential"], limit: 1000 } as never, ctx),
    ]);
    const uses = new Map<string, number>();
    for (const connection of connections.docs as unknown as ConnectionRecord[]) {
      if (connection.credential)
        uses.set(connection.credential, (uses.get(connection.credential) ?? 0) + 1);
    }
    const docs = credentials.docs as unknown as CredentialRecord[];
    return (
      <>
        <PageHeader
          title="Credentials"
          description="Secrets for connections. Encrypted at rest; never shown again."
          actions={
            collection.access.create ? (
              <ButtonLink href={`${basePath}/${CREDENTIALS}/new`}>New credential</ButtonLink>
            ) : null
          }
        />
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Kind</Th>
                <Th>Secret</Th>
                <Th>Used by</Th>
                <Th>Last test</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const count = uses.get(doc.id) ?? 0;
                return (
                  <Tr key={doc.id}>
                    <Td>
                      <Link
                        href={`${basePath}/${CREDENTIALS}/${encodeURIComponent(doc.id)}`}
                        className="qb:font-medium qb:text-zinc-900 qb:hover:underline"
                      >
                        {doc.name}
                      </Link>
                    </Td>
                    <Td>{kindLabel(doc.kind)}</Td>
                    <Td>
                      <span className="qb:font-mono qb:text-xs">{secretText(doc)}</span>
                    </Td>
                    <Td>{usedBy(count)}</Td>
                    <Td>
                      <TestBadge lastTest={doc.lastTest} />
                    </Td>
                  </Tr>
                );
              })}
              {docs.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="qb:px-4 qb:py-12 qb:text-center qb:text-sm qb:text-zinc-500"
                  >
                    No credentials yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card>
      </>
    );
  };
}

/** Create and detail page of a credential. */
export function createCredentialEdit(config: QuickbenConfig, key: string) {
  return async function CredentialEdit({ collection, basePath, id }: Readonly<ViewProps>) {
    const { qb, ctx, options } = await load(config);
    const listHref = `${basePath}/${CREDENTIALS}`;
    const cancel = (
      <ButtonLink href={listHref} variant="ghost">
        Cancel
      </ButtonLink>
    );
    if (id === undefined) {
      return (
        <>
          <PageHeader
            title="New credential"
            description="An API key, a service account key or a username and password."
            crumbs={[{ label: "Credentials", href: listHref }, { label: "New" }]}
          />
          <div className="qb:grid qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
            <Card>
              <CredentialForm
                action={saveCredentialAction.bind(null, key, null)}
                kinds={CREDENTIAL_KINDS}
                values={{ name: "", kind: "api_key" }}
                stored={null}
                submitLabel="Create credential"
                readOnly={!collection.access.create}
                secondary={cancel}
              />
            </Card>
          </div>
        </>
      );
    }
    const doc = (await qb.findById(CREDENTIALS, id, {}, ctx)) as unknown as CredentialRecord;
    const used = (
      await qb.find(
        CONNECTIONS,
        { where: { credential: { eq: id } }, sort: ["name"], limit: 500 },
        ctx,
      )
    ).docs as unknown as ConnectionRecord[];
    const providers = [...options.providers.values()]
      .filter(
        (provider) => provider.test !== undefined && provider.credential.kinds.includes(doc.kind),
      )
      .map((provider) => ({ type: provider.type, label: provider.label }));
    const readOnly = !collection.access.update;
    return (
      <>
        <PageHeader
          title={doc.name}
          description={kindLabel(doc.kind)}
          crumbs={[{ label: "Credentials", href: listHref }, { label: doc.name }]}
          actions={
            <>
              {readOnly ? <Badge>Read only</Badge> : null}
              {readOnly ? null : (
                <TestCredentialButton
                  action={testCredentialAction.bind(null, key, doc.id)}
                  providers={providers}
                  used={used.length > 0}
                />
              )}
            </>
          }
        />
        <div className="qb:grid qb:items-start qb:gap-6 qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
          <div className="qb:grid qb:gap-6">
            <Card>
              <CredentialForm
                action={saveCredentialAction.bind(null, key, doc.id)}
                kinds={CREDENTIAL_KINDS}
                values={{ name: doc.name, kind: doc.kind }}
                stored={{ hasSecret: doc.hasSecret === true, last4: doc.last4 }}
                submitLabel="Save changes"
                readOnly={readOnly}
                secondary={cancel}
              />
            </Card>
            <Card>
              <CardHeader title="Used by" description="A credential in use cannot be deleted." />
              <CardBody>
                {used.length === 0 ? (
                  <p className="qb:text-sm qb:text-zinc-500">No connection uses this credential.</p>
                ) : (
                  <ul className="qb:space-y-1 qb:text-sm">
                    {used.map((connection) => (
                      <li key={connection.id}>
                        <Link
                          href={`${basePath}/${CONNECTIONS}/${encodeURIComponent(connection.id)}`}
                          className="qb:font-medium qb:text-zinc-900 qb:hover:underline"
                        >
                          {connection.name}
                        </Link>{" "}
                        <span className="qb:text-zinc-500">
                          {options.providers.get(connection.providerType)?.label ??
                            connection.providerType}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Status" />
            <CardBody className="qb:space-y-4">
              <LastTestDetails lastTest={doc.lastTest} />
              <dl className="qb:space-y-3 qb:text-sm">
                <Detail label="Secret">
                  <span className="qb:font-mono qb:text-xs">{secretText(doc)}</span>
                </Detail>
                <Detail label="ID">
                  <span className="qb:font-mono qb:text-xs qb:break-all">{doc.id}</span>
                </Detail>
                <Detail label="Created">{formatDatetime(doc.createdAt)}</Detail>
                <Detail label="Updated">{formatDatetime(doc.updatedAt)}</Detail>
              </dl>
              {collection.access.delete ? (
                <DeleteButton
                  action={deleteAction.bind(null, key, CREDENTIALS, doc.id)}
                  label="credential"
                  title={doc.name}
                />
              ) : null}
            </CardBody>
          </Card>
        </div>
      </>
    );
  };
}

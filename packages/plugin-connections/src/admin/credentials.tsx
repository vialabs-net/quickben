import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ListToolbar,
  Table,
  Td,
  Th,
  Tr,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { CONNECTIONS, CREDENTIALS, getConnectionsOptions } from "../options";

import { deleteAction, saveCredentialAction, testCredentialAction } from "./actions";
import { CredentialForm } from "./credential-form";
import { DeleteButton } from "./delete-button";
import { describeProvider, kindLabel, kindOptions } from "./describe";
import {
  matchesFilter,
  matchesSearch,
  readFilters,
  stateFilter,
  stateOf,
  stateValues,
} from "./filters";
import { connectionsMessages } from "./messages";
import { DateTime, Detail, LastTestDetails, PageHeader, TestBadge } from "./shared";
import { maskedSecret } from "./state";
import { TestCredentialButton } from "./test-button";

import type { ConnectionRecord, CredentialRecord } from "../api";
import type { ConnectionsT } from "./messages";
import type { ViewProps } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

async function load(config: QuickbenConfig) {
  const ctx = await getRequestContext(config);
  const qb = await getQuickben(config);
  return { qb, ctx, options: getConnectionsOptions(qb) };
}

function usedBy(count: number, t: ConnectionsT): string {
  return count === 0 ? t("credentials.unused") : t("credentials.usedByCount", { count });
}

function secretText(credential: CredentialRecord, t: ConnectionsT): string {
  return maskedSecret({ hasSecret: credential.hasSecret === true, last4: credential.last4 }, t);
}

/** The list of credentials, with how many connections use each one. */
export function createCredentialsList(config: QuickbenConfig) {
  return async function CredentialsList({
    collection,
    basePath,
    searchParams,
    i18n,
  }: Readonly<ViewProps>) {
    const { t } = i18n.scope(connectionsMessages);
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
    const all = credentials.docs as unknown as CredentialRecord[];
    const kinds = kindOptions(t);
    const { q, filters } = readFilters(searchParams, {
      kind: kinds.map((kind) => kind.kind),
      use: ["used", "unused"],
      state: stateValues,
    });
    const docs = all.filter(
      (doc) =>
        matchesSearch(doc.name, q) &&
        matchesFilter(filters.kind, doc.kind) &&
        matchesFilter(filters.use, uses.has(doc.id) ? "used" : "unused") &&
        matchesFilter(filters.state, stateOf(doc.lastTest)),
    );
    const listHref = `${basePath}/${CREDENTIALS}`;
    return (
      <>
        <PageHeader
          i18n={i18n}
          title={t("credentials.title")}
          description={t("credentials.description")}
          actions={
            collection.access.create ? (
              <ButtonLink href={`${basePath}/${CREDENTIALS}/new`}>
                {t("credentials.new")}
              </ButtonLink>
            ) : null
          }
        />
        <Card>
          <ListToolbar
            action={listHref}
            idPrefix={`qb-${CREDENTIALS}`}
            search={{ label: t("filter.search"), value: q }}
            filters={[
              {
                name: "filter.kind",
                label: t("filter.kind"),
                value: filters.kind,
                options: kinds.map((kind) => ({ value: kind.kind, label: kind.label })),
              },
              {
                name: "filter.use",
                label: t("filter.use"),
                value: filters.use,
                options: [
                  { value: "used", label: t("filter.inUse") },
                  { value: "unused", label: t("credentials.unused") },
                ],
              },
              stateFilter(filters.state, i18n),
            ]}
            clearHref={listHref}
            i18n={i18n}
          />
          <Table>
            <thead>
              <tr>
                <Th>{t("column.name")}</Th>
                <Th>{t("column.kind")}</Th>
                <Th>{t("column.secret")}</Th>
                <Th>{t("column.usedBy")}</Th>
                <Th>{t("column.lastTest")}</Th>
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
                        className="qb:font-medium qb:text-fg qb:hover:underline"
                      >
                        {doc.name}
                      </Link>
                    </Td>
                    <Td>{kindLabel(doc.kind, t)}</Td>
                    <Td>
                      <span className="qb:font-mono qb:text-xs">{secretText(doc, t)}</span>
                    </Td>
                    <Td>{usedBy(count, t)}</Td>
                    <Td>
                      <TestBadge lastTest={doc.lastTest} i18n={i18n} />
                    </Td>
                  </Tr>
                );
              })}
              {docs.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="qb:px-4 qb:py-12 qb:text-center qb:text-sm qb:text-fg-muted"
                  >
                    {all.length === 0 ? t("credentials.empty") : t("credentials.noMatches")}
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
  return async function CredentialEdit({ collection, basePath, id, i18n }: Readonly<ViewProps>) {
    const { t } = i18n.scope(connectionsMessages);
    const { qb, ctx, options } = await load(config);
    const listHref = `${basePath}/${CREDENTIALS}`;
    const kinds = kindOptions(t);
    const cancel = (
      <ButtonLink href={listHref} variant="ghost">
        {t("action.cancel")}
      </ButtonLink>
    );
    if (id === undefined) {
      return (
        <>
          <PageHeader
            i18n={i18n}
            title={t("credentials.new")}
            description={t("credential.newDescription")}
            crumbs={[{ label: t("credentials.title"), href: listHref }, { label: t("crumb.new") }]}
          />
          <div className="qb:grid qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
            <Card>
              <CredentialForm
                action={saveCredentialAction.bind(null, key, null)}
                kinds={kinds}
                values={{ name: "", kind: "api_key" }}
                stored={null}
                submitLabel={t("credential.create")}
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
      .map((provider) => describeProvider(provider, i18n))
      .map((provider) => ({ type: provider.type, label: provider.label }));
    const providerLabel = (type: string) => {
      const provider = options.providers.get(type);
      return provider ? describeProvider(provider, i18n).label : type;
    };
    const readOnly = !collection.access.update;
    return (
      <>
        <PageHeader
          i18n={i18n}
          title={doc.name}
          description={kindLabel(doc.kind, t)}
          crumbs={[{ label: t("credentials.title"), href: listHref }, { label: doc.name }]}
          actions={
            <>
              {readOnly ? <Badge>{t("value.readOnly")}</Badge> : null}
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
                kinds={kinds}
                values={{ name: doc.name, kind: doc.kind }}
                stored={{ hasSecret: doc.hasSecret === true, last4: doc.last4 }}
                submitLabel={t("action.save")}
                readOnly={readOnly}
                secondary={cancel}
              />
            </Card>
            <Card>
              <CardHeader
                title={t("credential.usedBy")}
                description={t("credential.usedByDescription")}
              />
              <CardBody>
                {used.length === 0 ? (
                  <p className="qb:text-sm qb:text-fg-muted">{t("credential.notUsed")}</p>
                ) : (
                  <ul className="qb:space-y-1 qb:text-sm">
                    {used.map((connection) => (
                      <li key={connection.id}>
                        <Link
                          href={`${basePath}/${CONNECTIONS}/${encodeURIComponent(connection.id)}`}
                          className="qb:font-medium qb:text-fg qb:hover:underline"
                        >
                          {connection.name}
                        </Link>{" "}
                        <span className="qb:text-fg-muted">
                          {providerLabel(connection.providerType)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title={t("status.title")} />
            <CardBody className="qb:space-y-4">
              <LastTestDetails lastTest={doc.lastTest} i18n={i18n} />
              <dl className="qb:space-y-3 qb:text-sm">
                <Detail label={t("detail.secret")}>
                  <span className="qb:font-mono qb:text-xs">{secretText(doc, t)}</span>
                </Detail>
                <Detail label={t("detail.id")}>
                  <span className="qb:font-mono qb:text-xs qb:break-all">{doc.id}</span>
                </Detail>
                <Detail label={t("detail.created")}>
                  <DateTime value={doc.createdAt} i18n={i18n} />
                </Detail>
                <Detail label={t("detail.updated")}>
                  <DateTime value={doc.updatedAt} i18n={i18n} />
                </Detail>
              </dl>
              {collection.access.delete ? (
                <DeleteButton
                  action={deleteAction.bind(null, key, CREDENTIALS, doc.id)}
                  kind="credential"
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

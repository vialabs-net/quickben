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
import { providersByCategory } from "../provider";

import { deleteAction, saveConnectionAction, testConnectionAction } from "./actions";
import { ConnectionForm } from "./connection-form";
import { DeleteButton } from "./delete-button";
import { describeProvider } from "./describe";
import {
  allPages,
  isFiltered,
  listWhere,
  matchesFilter,
  readFilters,
  stateFilter,
  stateOf,
  stateValues,
} from "./filters";
import { connectionsMessages } from "./messages";
import {
  DateTime,
  Detail,
  LastTestDetails,
  PageHeader,
  ProviderMark,
  RelativeTime,
  TestBadge,
} from "./shared";
import { TestConnectionButton } from "./test-button";

import type { ConnectionRecord, CredentialRecord } from "../api";
import type { ProviderView } from "./describe";
import type { ConnectionsT } from "./messages";
import type { AdminI18n, ViewProps } from "@quickben/admin";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

type Loaded = ConnectionRecord<string | CredentialRecord | null>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function load(config: QuickbenConfig) {
  const ctx = await getRequestContext(config);
  const qb = await getQuickben(config);
  return { qb, ctx, options: getConnectionsOptions(qb) };
}

function credentialLabel(credential: Loaded["credential"], t: ConnectionsT): string {
  if (credential === null) return t("value.none");
  if (typeof credential === "string") return t("value.hidden");
  return credential.last4 ? `${credential.name} (•••• ${credential.last4})` : credential.name;
}

/** The list of connections. */
export function createConnectionsList(config: QuickbenConfig, key: string) {
  return async function ConnectionsList({
    collection,
    basePath,
    searchParams,
    i18n,
  }: Readonly<ViewProps>) {
    const { t } = i18n.scope(connectionsMessages);
    const { qb, ctx, options } = await load(config);
    const providers = [...options.providers.values()].map((provider) =>
      describeProvider(provider, i18n),
    );
    const { q, filters } = readFilters(searchParams, {
      provider: providers.map((provider) => provider.type),
      enabled: ["true", "false"],
      state: stateValues,
    });
    const where = listWhere(q, {
      providerType: filters.provider === "" ? null : filters.provider,
      enabled: filters.enabled === "" ? null : filters.enabled === "true",
    });
    const loadPage = (page: number) =>
      qb.find(CONNECTIONS, { ...where, sort: ["name"], limit: 500, depth: 1, page } as never, ctx);
    const loaded = filters.state === "" ? (await loadPage(1)).docs : await allPages(loadPage);
    // The state comes from the last test, so it is filtered here.
    const docs = (loaded as unknown as Loaded[]).filter((doc) =>
      matchesFilter(filters.state, stateOf(doc.lastTest)),
    );
    const listHref = `${basePath}/${CONNECTIONS}`;
    const manage = collection.access.update;
    return (
      <>
        <PageHeader
          i18n={i18n}
          title={t("list.title")}
          description={t("list.description")}
          actions={
            collection.access.create ? (
              <ButtonLink href={`${basePath}/${CONNECTIONS}/new`}>{t("list.new")}</ButtonLink>
            ) : null
          }
        />
        <Card>
          <ListToolbar
            action={listHref}
            idPrefix={`qb-${CONNECTIONS}`}
            search={{ label: t("filter.search"), value: q }}
            filters={[
              {
                name: "filter.provider",
                label: t("filter.provider"),
                value: filters.provider,
                options: providers.map((provider) => ({
                  value: provider.type,
                  label: provider.label,
                })),
              },
              {
                name: "filter.enabled",
                label: t("filter.enabled"),
                value: filters.enabled,
                options: [
                  { value: "true", label: i18n.t("value.yes") },
                  { value: "false", label: i18n.t("value.no") },
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
                <Th>{t("column.provider")}</Th>
                <Th>{t("column.credential")}</Th>
                <Th>{t("column.status")}</Th>
                <Th>{t("column.lastTest")}</Th>
                {manage ? (
                  <Th>
                    <span className="qb:sr-only">{t("column.actions")}</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const target = options.providers.get(doc.providerType);
                const provider = target ? describeProvider(target, i18n) : null;
                return (
                  <Tr key={doc.id}>
                    <Td>
                      <div className="qb:flex qb:items-center qb:gap-3">
                        <ProviderMark
                          label={provider?.label ?? doc.providerType}
                          logo={provider?.logo}
                          muted={!doc.enabled}
                        />
                        <Link
                          href={`${basePath}/${CONNECTIONS}/${encodeURIComponent(doc.id)}`}
                          className="qb:font-medium qb:text-fg qb:hover:underline"
                        >
                          {doc.name}
                        </Link>
                        {doc.enabled ? null : <Badge>{t("value.disabled")}</Badge>}
                      </div>
                    </Td>
                    <Td>
                      {provider ? `${provider.label} · ${provider.category}` : doc.providerType}
                    </Td>
                    <Td>{credentialLabel(doc.credential, t)}</Td>
                    <Td>
                      <TestBadge lastTest={doc.lastTest} i18n={i18n} />
                    </Td>
                    <Td>
                      {doc.lastTest ? (
                        <RelativeTime value={doc.lastTest.at} i18n={i18n} />
                      ) : (
                        i18n.t("value.empty")
                      )}
                    </Td>
                    {manage ? (
                      <Td>
                        {provider?.testable ? (
                          <TestConnectionButton
                            size="sm"
                            action={testConnectionAction.bind(null, key, doc.id)}
                          />
                        ) : null}
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
              {docs.length === 0 ? (
                <tr>
                  <td
                    colSpan={manage ? 6 : 5}
                    className="qb:px-4 qb:py-12 qb:text-center qb:text-sm qb:text-fg-muted"
                  >
                    {isFiltered(q, filters) ? t("list.noMatches") : t("list.empty")}
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

function ProviderPicker({
  basePath,
  providers,
  i18n,
}: Readonly<{ basePath: string; providers: ProviderView[]; i18n: AdminI18n }>) {
  const { t } = i18n.scope(connectionsMessages);
  return (
    <>
      <PageHeader
        i18n={i18n}
        title={t("picker.title")}
        description={t("picker.description")}
        crumbs={[
          { label: t("list.title"), href: `${basePath}/${CONNECTIONS}` },
          { label: t("crumb.new") },
        ]}
      />
      <div className="qb:grid qb:gap-6">
        {providersByCategory(providers).map(({ category, providers: group }) => (
          <section key={category} aria-labelledby={`qb-category-${category}`}>
            <h2
              id={`qb-category-${category}`}
              className="qb:mb-3 qb:text-xs qb:font-medium qb:tracking-wide qb:text-fg-muted qb:uppercase"
            >
              {category}
            </h2>
            <ul className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6">
              {group.map((provider) => (
                <li key={provider.type} className="qb:md:col-span-3">
                  <Link
                    href={`${basePath}/${CONNECTIONS}/new?provider=${encodeURIComponent(provider.type)}`}
                    className="qb:flex qb:items-start qb:gap-3 qb:rounded-lg qb:border qb:border-line qb:bg-surface qb:px-4 qb:py-3 qb:shadow-xs qb:hover:bg-surface-muted"
                  >
                    <ProviderMark label={provider.label} logo={provider.logo} />
                    <span className="qb:min-w-0">
                      <span className="qb:block qb:text-sm qb:font-medium qb:text-fg">
                        {provider.label}
                      </span>
                      <span className="qb:block qb:text-sm qb:text-fg-muted">
                        {provider.description}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

async function credentialOptions(qb: Quickben, ctx: RequestContext, provider: ProviderView) {
  const result = await qb.find(
    CREDENTIALS,
    { where: { kind: { in: provider.credential.kinds } }, sort: ["name"], limit: 500 },
    ctx,
  );
  return (result.docs as unknown as CredentialRecord[]).map((credential) => ({
    id: credential.id,
    label: credential.last4 ? `${credential.name} (•••• ${credential.last4})` : credential.name,
  }));
}

/** Create (provider picker, then form) and detail page of a connection. */
export function createConnectionEdit(config: QuickbenConfig, key: string) {
  return async function ConnectionEdit({
    collection,
    basePath,
    searchParams,
    id,
    i18n,
  }: Readonly<ViewProps>) {
    const { t } = i18n.scope(connectionsMessages);
    const { qb, ctx, options } = await load(config);
    const listHref = `${basePath}/${CONNECTIONS}`;
    const newCredentialHref = `${basePath}/${CREDENTIALS}/new`;
    if (id === undefined) {
      const providers = [...options.providers.values()].map((provider) =>
        describeProvider(provider, i18n),
      );
      const chosen = providers.find((provider) => provider.type === first(searchParams.provider));
      if (!chosen) return <ProviderPicker basePath={basePath} providers={providers} i18n={i18n} />;
      return (
        <>
          <PageHeader
            i18n={i18n}
            title={t("connection.newTitle", { provider: chosen.label })}
            description={chosen.description}
            leading={<ProviderMark label={chosen.label} logo={chosen.logo} />}
            crumbs={[
              { label: t("list.title"), href: listHref },
              { label: t("crumb.new"), href: `${listHref}/new` },
              { label: chosen.label },
            ]}
          />
          <div>
            <Card>
              <ConnectionForm
                action={saveConnectionAction.bind(null, key, null, chosen.type)}
                provider={chosen}
                values={{
                  name: chosen.label,
                  baseUrl: null,
                  credential: null,
                  enabled: true,
                  metadata: {},
                }}
                credentials={await credentialOptions(qb, ctx, chosen)}
                newCredentialHref={newCredentialHref}
                submitLabel={t("connection.create")}
                readOnly={!collection.access.create}
                secondary={
                  <ButtonLink href={`${listHref}/new`} variant="ghost">
                    {t("action.back")}
                  </ButtonLink>
                }
              />
            </Card>
          </div>
        </>
      );
    }
    const doc = (await qb.findById(CONNECTIONS, id, { depth: 1 }, ctx)) as unknown as Loaded;
    const target = options.providers.get(doc.providerType);
    const provider = target ? describeProvider(target, i18n) : null;
    const readOnly = !collection.access.update;
    const credentialId =
      typeof doc.credential === "string" ? doc.credential : (doc.credential?.id ?? null);
    return (
      <>
        <PageHeader
          i18n={i18n}
          title={doc.name}
          description={
            provider
              ? `${provider.label} · ${provider.category}`
              : t("connection.unknownProvider", { type: doc.providerType })
          }
          leading={
            <ProviderMark
              label={provider?.label ?? doc.providerType}
              logo={provider?.logo}
              muted={!doc.enabled}
            />
          }
          crumbs={[{ label: t("list.title"), href: listHref }, { label: doc.name }]}
          actions={
            <>
              {readOnly ? <Badge>{t("value.readOnly")}</Badge> : null}
              {!readOnly && provider?.testable ? (
                <TestConnectionButton action={testConnectionAction.bind(null, key, doc.id)} />
              ) : null}
            </>
          }
        />
        <div className="qb:@container">
          <div className="qb:grid qb:items-start qb:gap-6 qb:@min-[80rem]:grid-cols-[minmax(0,1fr)_16rem]">
            <Card>
              {provider ? (
                <ConnectionForm
                  action={saveConnectionAction.bind(null, key, doc.id, doc.providerType)}
                  provider={provider}
                  values={{
                    name: doc.name,
                    baseUrl: doc.baseUrl,
                    credential: credentialId,
                    enabled: doc.enabled,
                    metadata: doc.metadata,
                  }}
                  credentials={await credentialOptions(qb, ctx, provider)}
                  newCredentialHref={newCredentialHref}
                  submitLabel={t("action.save")}
                  readOnly={readOnly}
                  secondary={
                    <ButtonLink href={listHref} variant="ghost">
                      {t("action.cancel")}
                    </ButtonLink>
                  }
                />
              ) : (
                <CardBody>
                  <p className="qb:text-sm qb:text-fg-muted">
                    {t("connection.notRegistered", { type: doc.providerType })}
                  </p>
                </CardBody>
              )}
            </Card>
            <Card>
              <CardHeader title={t("status.title")} />
              <CardBody className="qb:space-y-4">
                <LastTestDetails lastTest={doc.lastTest} i18n={i18n} />
                <dl className="qb:space-y-3 qb:text-sm">
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
                    action={deleteAction.bind(null, key, CONNECTIONS, doc.id)}
                    kind="connection"
                    title={doc.name}
                  />
                ) : null}
              </CardBody>
            </Card>
          </div>
        </div>
      </>
    );
  };
}

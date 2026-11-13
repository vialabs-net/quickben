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
import { providersByCategory } from "../provider";

import { deleteAction, saveConnectionAction, testConnectionAction } from "./actions";
import { ConnectionForm } from "./connection-form";
import { DeleteButton } from "./delete-button";
import { describeProvider } from "./describe";
import {
  Detail,
  formatDatetime,
  LastTestDetails,
  PageHeader,
  ProviderMark,
  TestBadge,
} from "./shared";
import { TestConnectionButton } from "./test-button";

import type { ConnectionRecord, CredentialRecord } from "../api";
import type { ProviderView } from "./describe";
import type { ViewProps } from "@quickben/admin";
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

function credentialLabel(credential: Loaded["credential"]): string {
  if (credential === null) return "None";
  if (typeof credential === "string") return "Hidden";
  return credential.last4 ? `${credential.name} (•••• ${credential.last4})` : credential.name;
}

/** The list of connections. */
export function createConnectionsList(config: QuickbenConfig, key: string) {
  return async function ConnectionsList({ collection, basePath }: Readonly<ViewProps>) {
    const { qb, ctx, options } = await load(config);
    const result = await qb.find(
      CONNECTIONS,
      { sort: ["name"], limit: 500, depth: 1 } as never,
      ctx,
    );
    const docs = result.docs as unknown as Loaded[];
    const manage = collection.access.update;
    return (
      <>
        <PageHeader
          title="Connections"
          description="External providers and the credential each one uses."
          actions={
            collection.access.create ? (
              <ButtonLink href={`${basePath}/${CONNECTIONS}/new`}>New connection</ButtonLink>
            ) : null
          }
        />
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Provider</Th>
                <Th>Credential</Th>
                <Th>Status</Th>
                <Th>Last test</Th>
                {manage ? (
                  <Th>
                    <span className="qb:sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const provider = options.providers.get(doc.providerType);
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
                          className="qb:font-medium qb:text-zinc-900 qb:hover:underline"
                        >
                          {doc.name}
                        </Link>
                        {doc.enabled ? null : <Badge>Disabled</Badge>}
                      </div>
                    </Td>
                    <Td>
                      {provider ? `${provider.label} · ${provider.category}` : doc.providerType}
                    </Td>
                    <Td>{credentialLabel(doc.credential)}</Td>
                    <Td>
                      <TestBadge lastTest={doc.lastTest} />
                    </Td>
                    <Td>{doc.lastTest ? formatDatetime(doc.lastTest.at) : "—"}</Td>
                    {manage ? (
                      <Td>
                        {provider?.test ? (
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
                    className="qb:px-4 qb:py-12 qb:text-center qb:text-sm qb:text-zinc-500"
                  >
                    No connections yet. A connection is an external provider (AI models, identity,
                    any API) with the credential it uses.
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
}: Readonly<{ basePath: string; providers: ProviderView[] }>) {
  return (
    <>
      <PageHeader
        title="New connection"
        description="Choose a provider."
        crumbs={[{ label: "Connections", href: `${basePath}/${CONNECTIONS}` }, { label: "New" }]}
      />
      <div className="qb:grid qb:gap-6">
        {providersByCategory(providers).map(({ category, providers: group }) => (
          <section key={category} aria-labelledby={`qb-category-${category}`}>
            <h2
              id={`qb-category-${category}`}
              className="qb:mb-3 qb:text-xs qb:font-medium qb:tracking-wide qb:text-zinc-500 qb:uppercase"
            >
              {category}
            </h2>
            <ul className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6">
              {group.map((provider) => (
                <li key={provider.type} className="qb:md:col-span-3">
                  <Link
                    href={`${basePath}/${CONNECTIONS}/new?provider=${encodeURIComponent(provider.type)}`}
                    className="qb:flex qb:items-start qb:gap-3 qb:rounded-lg qb:border qb:border-zinc-200 qb:bg-white qb:px-4 qb:py-3 qb:shadow-xs qb:hover:bg-zinc-50"
                  >
                    <ProviderMark label={provider.label} logo={provider.logo} />
                    <span className="qb:min-w-0">
                      <span className="qb:block qb:text-sm qb:font-medium qb:text-zinc-900">
                        {provider.label}
                      </span>
                      <span className="qb:block qb:text-sm qb:text-zinc-500">
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
  }: Readonly<ViewProps>) {
    const { qb, ctx, options } = await load(config);
    const listHref = `${basePath}/${CONNECTIONS}`;
    const newCredentialHref = `${basePath}/${CREDENTIALS}/new`;
    if (id === undefined) {
      const providers = [...options.providers.values()].map(describeProvider);
      const chosen = providers.find((provider) => provider.type === first(searchParams.provider));
      if (!chosen) return <ProviderPicker basePath={basePath} providers={providers} />;
      return (
        <>
          <PageHeader
            title={`New ${chosen.label} connection`}
            description={chosen.description}
            leading={<ProviderMark label={chosen.label} logo={chosen.logo} />}
            crumbs={[
              { label: "Connections", href: listHref },
              { label: "New", href: `${listHref}/new` },
              { label: chosen.label },
            ]}
          />
          <div className="qb:grid qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
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
                submitLabel="Create connection"
                readOnly={!collection.access.create}
                secondary={
                  <ButtonLink href={`${listHref}/new`} variant="ghost">
                    Back
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
    const provider = target ? describeProvider(target) : null;
    const readOnly = !collection.access.update;
    const credentialId =
      typeof doc.credential === "string" ? doc.credential : (doc.credential?.id ?? null);
    return (
      <>
        <PageHeader
          title={doc.name}
          description={
            provider
              ? `${provider.label} · ${provider.category}`
              : `Unknown provider ${doc.providerType}`
          }
          leading={
            <ProviderMark
              label={provider?.label ?? doc.providerType}
              logo={provider?.logo}
              muted={!doc.enabled}
            />
          }
          crumbs={[{ label: "Connections", href: listHref }, { label: doc.name }]}
          actions={
            <>
              {readOnly ? <Badge>Read only</Badge> : null}
              {!readOnly && provider?.testable ? (
                <TestConnectionButton action={testConnectionAction.bind(null, key, doc.id)} />
              ) : null}
            </>
          }
        />
        <div className="qb:grid qb:items-start qb:gap-6 qb:xl:grid-cols-[minmax(0,60rem)_18rem]">
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
                submitLabel="Save changes"
                readOnly={readOnly}
                secondary={
                  <ButtonLink href={listHref} variant="ghost">
                    Cancel
                  </ButtonLink>
                }
              />
            ) : (
              <CardBody>
                <p className="qb:text-sm qb:text-zinc-600">
                  The provider type “{doc.providerType}” is not registered. Register it with
                  defineProvider to edit this connection.
                </p>
              </CardBody>
            )}
          </Card>
          <Card>
            <CardHeader title="Status" />
            <CardBody className="qb:space-y-4">
              <LastTestDetails lastTest={doc.lastTest} />
              <dl className="qb:space-y-3 qb:text-sm">
                <Detail label="ID">
                  <span className="qb:font-mono qb:text-xs qb:break-all">{doc.id}</span>
                </Detail>
                <Detail label="Created">{formatDatetime(doc.createdAt)}</Detail>
                <Detail label="Updated">{formatDatetime(doc.updatedAt)}</Detail>
              </dl>
              {collection.access.delete ? (
                <DeleteButton
                  action={deleteAction.bind(null, key, CONNECTIONS, doc.id)}
                  label="connection"
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

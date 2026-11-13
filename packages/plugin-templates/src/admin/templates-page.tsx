import { Badge, ButtonLink, Card, Table, Td, Th, Tr } from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";

import { getTemplatesPlugin, VERSIONS } from "../options";
import { getTemplate, getTemplateKinds, listTemplates } from "../service";

import {
  archiveAction,
  discardDraftAction,
  pdfAction,
  previewAction,
  publishAction,
  restoreAction,
  saveDraftAction,
} from "./actions";
import { editorContent } from "./editor-content";
import { canManage, Heading, load, Notice } from "./shared";
import { TemplateWorkspace } from "./workspace";

import type { TemplateSummary } from "../service";
import type { PageProps } from "@quickben/admin";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

function Status({ summary }: Readonly<{ summary: TemplateSummary }>) {
  let published = <Badge>Not published</Badge>;
  if (summary.published) {
    published = <Badge tone="green">Published · v{summary.published.number}</Badge>;
  } else if (summary.hasBase) {
    published = <Badge>Base template</Badge>;
  }
  return (
    <span className="qbt:flex qbt:flex-wrap qbt:gap-1">
      {published}
      {summary.draft ? <Badge tone="amber">Draft · v{summary.draft.number}</Badge> : null}
    </span>
  );
}

function TemplateList({
  summaries,
  basePath,
}: Readonly<{ summaries: TemplateSummary[]; basePath: string }>) {
  if (summaries.length === 0) return <Notice>No template kinds are registered.</Notice>;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Document</Th>
            <Th>Status</Th>
            <Th>
              <span className="qbt:sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <Tr key={summary.kind}>
              <Td>
                <p className="qbt:font-medium qbt:text-zinc-900">{summary.label}</p>
                {summary.description ? (
                  <p className="qbt:text-xs qbt:text-zinc-500">{summary.description}</p>
                ) : null}
              </Td>
              <Td>
                <Status summary={summary} />
              </Td>
              <Td className="qbt:text-right">
                <ButtonLink
                  href={`${basePath}/templates/${summary.kind}`}
                  variant="secondary"
                  size="sm"
                  aria-label={`Edit ${summary.label}`}
                >
                  Edit
                </ButtonLink>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function editorPage({
  qb,
  ctx,
  kind,
  basePath,
  actionKey,
}: Readonly<{
  qb: Quickben;
  ctx: RequestContext;
  kind: string;
  basePath: string;
  actionKey: string;
}>) {
  const known = getTemplateKinds(qb).find((k) => k.kind === kind);
  const back = `${basePath}/templates`;
  if (!known) {
    return (
      <>
        <Heading title="Unknown template" />
        <Notice>There is no template kind “{kind}”.</Notice>
      </>
    );
  }
  const loaded = await load(async () => ({
    detail: await getTemplate(qb, kind, ctx),
    canEdit: await canManage(qb, VERSIONS, ctx),
  }));
  if (!loaded.value) {
    return (
      <>
        <Heading title={known.label} />
        <Notice>{loaded.message}</Notice>
      </>
    );
  }
  const { detail, canEdit } = loaded.value;
  const bind = <A extends unknown[], R>(action: (key: string, kind: string, ...args: A) => R) =>
    action.bind(null, actionKey, kind);
  return (
    <TemplateWorkspace
      kind={kind}
      label={known.label}
      back={back}
      catalog={[...known.catalog]}
      initialContent={
        editorContent(qb, detail) ?? { type: "doc", content: [{ type: "paragraph" }] }
      }
      draft={detail.draft ? { number: detail.draft.number } : null}
      published={detail.published ? { number: detail.published.number } : null}
      versions={detail.versions}
      canEdit={canEdit}
      hasPdf={getTemplatesPlugin(qb).pdf !== null}
      actions={{
        save: bind(saveDraftAction),
        publish: bind(publishAction),
        discard: bind(discardDraftAction),
        archive: bind(archiveAction),
        restore: bind(restoreAction),
        preview: bind(previewAction),
        pdf: bind(pdfAction),
      }}
    />
  );
}

/** Build the Templates page: the list of kinds, and the editor at `templates/<kind>`. */
export function createTemplatesPage(config: QuickbenConfig, key: string) {
  return async function TemplatesPage({ segments, basePath }: Readonly<PageProps>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const kind = segments[0];
    if (kind !== undefined) {
      return editorPage({ qb, ctx, kind, basePath, actionKey: key });
    }
    const loaded = await load(() => listTemplates(qb, ctx));
    return (
      <>
        <Heading
          title="Document templates"
          description="Edit the text of each document. New documents use the published version."
        />
        {loaded.value ? (
          <TemplateList summaries={loaded.value} basePath={basePath} />
        ) : (
          <Notice>{loaded.message}</Notice>
        )}
      </>
    );
  };
}

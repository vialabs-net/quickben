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
import { templatesMessages } from "./messages";
import { canManage, Heading, load, Notice } from "./shared";
import { TemplateWorkspace } from "./workspace";

import type { TemplateSummary } from "../service";
import type { TemplatesT } from "./messages";
import type { AdminI18n, PageProps } from "@quickben/admin";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

function Status({ summary, t }: Readonly<{ summary: TemplateSummary; t: TemplatesT }>) {
  let published = <Badge>{t("status.notPublished")}</Badge>;
  if (summary.published) {
    published = (
      <Badge tone="green">{t("status.published", { number: summary.published.number })}</Badge>
    );
  } else if (summary.hasBase) {
    published = <Badge>{t("status.base")}</Badge>;
  }
  return (
    <span className="qbt:flex qbt:flex-wrap qbt:gap-1">
      {published}
      {summary.draft ? (
        <Badge tone="amber">{t("status.draft", { number: summary.draft.number })}</Badge>
      ) : null}
    </span>
  );
}

function TemplateList({
  summaries,
  basePath,
  i18n,
}: Readonly<{ summaries: TemplateSummary[]; basePath: string; i18n: AdminI18n }>) {
  const { t } = i18n.scope(templatesMessages);
  if (summaries.length === 0) return <Notice>{t("list.empty")}</Notice>;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>{t("list.document")}</Th>
            <Th>{t("list.status")}</Th>
            <Th>
              <span className="qbt:sr-only">{t("list.actions")}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => {
            const label = i18n.text(summary.label);
            const description = i18n.text(summary.description);
            return (
              <Tr key={summary.kind}>
                <Td>
                  <p className="qbt:font-medium qbt:text-fg">{label}</p>
                  {description ? (
                    <p className="qbt:text-xs qbt:text-fg-muted">{description}</p>
                  ) : null}
                </Td>
                <Td>
                  <Status summary={summary} t={t} />
                </Td>
                <Td className="qbt:text-right">
                  <ButtonLink
                    href={`${basePath}/templates/${summary.kind}`}
                    variant="secondary"
                    size="sm"
                    aria-label={t("list.editLabel", { label })}
                  >
                    {t("list.edit")}
                  </ButtonLink>
                </Td>
              </Tr>
            );
          })}
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
  i18n,
}: Readonly<{
  qb: Quickben;
  ctx: RequestContext;
  kind: string;
  basePath: string;
  actionKey: string;
  i18n: AdminI18n;
}>) {
  const { t } = i18n.scope(templatesMessages);
  const known = getTemplateKinds(qb).find((k) => k.kind === kind);
  const back = `${basePath}/templates`;
  if (!known) {
    return (
      <>
        <Heading title={t("editor.unknownTitle")} />
        <Notice>{t("editor.unknownKind", { kind })}</Notice>
      </>
    );
  }
  const loaded = await load(async () => ({
    detail: await getTemplate(qb, kind, ctx),
    canEdit: await canManage(qb, VERSIONS, ctx),
  }));
  const label = i18n.text(known.label);
  if (!loaded.value) {
    return (
      <>
        <Heading title={label} />
        <Notice>{t(`error.${loaded.code}`)}</Notice>
      </>
    );
  }
  const { detail, canEdit } = loaded.value;
  const bind = <A extends unknown[], R>(action: (key: string, kind: string, ...args: A) => R) =>
    action.bind(null, actionKey, kind);
  return (
    <TemplateWorkspace
      kind={kind}
      label={label}
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
  return async function TemplatesPage({ segments, basePath, i18n }: Readonly<PageProps>) {
    const { t } = i18n.scope(templatesMessages);
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const kind = segments[0];
    if (kind !== undefined) {
      return editorPage({ qb, ctx, kind, basePath, actionKey: key, i18n });
    }
    const loaded = await load(() => listTemplates(qb, ctx));
    return (
      <>
        <Heading title={t("list.title")} description={t("list.description")} />
        {loaded.value ? (
          <TemplateList summaries={loaded.value} basePath={basePath} i18n={i18n} />
        ) : (
          <Notice>{t(`error.${loaded.code}`)}</Notice>
        )}
      </>
    );
  };
}

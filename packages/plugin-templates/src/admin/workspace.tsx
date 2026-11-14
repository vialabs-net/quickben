"use client";

import { useAdminI18n } from "@quickben/admin/i18n";
import { Badge, Button, ButtonLink, Card, CardBody, CardHeader } from "@quickben/admin/ui";
import { useRouter } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { templatesMessages } from "./messages";

import type { TemplateContent, TemplateIssue } from "../content";
import type { CatalogVariable } from "../kinds";
import type { VersionSummary } from "../service";
import type { ActionResult } from "./actions";
import type { EditorApi } from "./editor-types";
import type { FeedbackErrorCode } from "./feedback";
import type { TemplatesT } from "./messages";

// TipTap is large: load it only on the editor page.
const TemplateEditor = lazy(() => import("./tiptap"));

const DEBOUNCE_MS = 400;

/** Template actions, bound to the admin instance and the kind. */
export interface WorkspaceActions {
  save: (content: unknown) => Promise<ActionResult<{ number: number; issues: TemplateIssue[] }>>;
  publish: (content: unknown) => Promise<ActionResult<{ number: number }>>;
  discard: () => Promise<ActionResult<{ content: TemplateContent | null }>>;
  archive: () => Promise<ActionResult<null>>;
  restore: (versionId: string) => Promise<ActionResult<{ content: TemplateContent | null }>>;
  /** `reference` is printed as the document reference, in the admin's language. */
  preview: (
    content: unknown,
    reference?: string,
  ) => Promise<ActionResult<{ html: string; issues: TemplateIssue[] }>>;
  pdf: (
    content: unknown,
    reference?: string,
  ) => Promise<ActionResult<{ base64: string; fileName: string }>>;
}

/** Props of {@link TemplateWorkspace}. */
export interface WorkspaceProps {
  kind: string;
  label: string;
  back: string;
  catalog: CatalogVariable[];
  initialContent: TemplateContent;
  draft: { number: number } | null;
  published: { number: number } | null;
  versions: VersionSummary[];
  canEdit: boolean;
  hasPdf: boolean;
  actions: WorkspaceActions;
}

type Confirm =
  | { type: "publish" }
  | { type: "discard" }
  | { type: "archive" }
  | { type: "restore"; version: VersionSummary };

const confirmText = (confirm: Confirm, t: TemplatesT) => {
  switch (confirm.type) {
    case "publish":
      return {
        title: t("confirm.publishTitle"),
        body: t("confirm.publishBody"),
        action: t("confirm.publishAction"),
      };
    case "discard":
      return {
        title: t("confirm.discardTitle"),
        body: t("confirm.discardBody"),
        action: t("confirm.discardAction"),
      };
    case "archive":
      return {
        title: t("confirm.archiveTitle"),
        body: t("confirm.archiveBody"),
        action: t("confirm.archiveAction"),
      };
    default:
      return {
        title: t("confirm.restoreTitle", { number: confirm.version.number }),
        body: t("confirm.restoreBody"),
        action: t("confirm.restoreAction"),
      };
  }
};

const useT = () => useAdminI18n().scope(templatesMessages).t;

function download(base64: string, fileName: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

function History({
  versions,
  canEdit,
  onRestore,
}: Readonly<{
  versions: VersionSummary[];
  canEdit: boolean;
  onRestore: (v: VersionSummary) => void;
}>) {
  const i18n = useAdminI18n();
  const t = i18n.scope(templatesMessages).t;
  if (versions.length === 0) return null;
  const tone = { draft: "amber", published: "green", archived: "neutral" } as const;
  const when = (iso: string | null) => (iso ? i18n.dateTime(iso) : "");
  return (
    <Card className="qbt:mt-6" role="region" aria-label={t("history.title")}>
      <CardHeader title={t("history.title")} description={t("history.description")} />
      <ul className="qbt:divide-y qbt:divide-line-soft">
        {versions.map((version) => (
          <li
            key={version.id}
            className="qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-3 qbt:px-5 qbt:py-2.5 qbt:text-sm"
          >
            <span className="qbt:w-10 qbt:font-medium qbt:text-fg">v{version.number}</span>
            <Badge tone={tone[version.status]}>{t(`version.${version.status}`)}</Badge>
            <span className="qbt:text-fg-muted">
              {[
                when(version.publishedAt ?? version.updatedAt),
                version.restoredFrom === null
                  ? ""
                  : t("history.restoredFrom", { number: version.restoredFrom }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {canEdit && version.status !== "draft" ? (
              <Button
                size="sm"
                variant="ghost"
                className="qbt:ml-auto"
                onClick={() => {
                  onRestore(version);
                }}
              >
                {t("history.restore", { number: version.number })}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WorkspaceHeader({
  back,
  label,
  draft,
  published,
  canEdit,
  hasPdf,
  dirty,
  busy,
  onPdf,
  onSave,
  onConfirm,
}: Readonly<
  Pick<WorkspaceProps, "back" | "label" | "draft" | "published" | "canEdit" | "hasPdf"> & {
    dirty: boolean;
    busy: boolean;
    onPdf: () => void;
    onSave: () => void;
    onConfirm: (confirm: Confirm) => void;
  }
>) {
  const t = useT();
  const ask = (confirm: Confirm) => () => {
    onConfirm(confirm);
  };
  return (
    <header className="qbt:mb-4 qbt:flex qbt:flex-wrap qbt:items-start qbt:justify-between qbt:gap-4">
      <div className="qbt:min-w-0">
        <ButtonLink href={back} variant="ghost" size="sm" className="qbt:-ml-3 qbt:mb-1">
          {t("workspace.back")}
        </ButtonLink>
        <h1 className="qbt:text-2xl qbt:font-semibold qbt:tracking-tight qbt:text-fg">{label}</h1>
        <p className="qbt:mt-2 qbt:flex qbt:flex-wrap qbt:gap-1">
          {published ? (
            <Badge tone="green">{t("status.published", { number: published.number })}</Badge>
          ) : (
            <Badge>{t("status.notPublished")}</Badge>
          )}
          {draft ? <Badge tone="amber">{t("status.draft", { number: draft.number })}</Badge> : null}
          {dirty ? <Badge tone="blue">{t("status.unsaved")}</Badge> : null}
        </p>
      </div>
      <div className="qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-2">
        {hasPdf ? (
          <Button variant="ghost" size="sm" onClick={onPdf} disabled={busy}>
            {t("workspace.downloadPdf")}
          </Button>
        ) : null}
        {canEdit && published ? (
          <Button variant="ghost" size="sm" onClick={ask({ type: "archive" })} disabled={busy}>
            {t("workspace.archive")}
          </Button>
        ) : null}
        {canEdit && draft ? (
          <Button variant="ghost" size="sm" onClick={ask({ type: "discard" })} disabled={busy}>
            {t("workspace.discard")}
          </Button>
        ) : null}
        {canEdit ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={onSave}
              disabled={busy}
              title={t("workspace.saveShortcut")}
            >
              {t("workspace.save")}
            </Button>
            <Button size="sm" onClick={ask({ type: "publish" })} disabled={busy}>
              {t("workspace.publish")}
            </Button>
          </>
        ) : null}
      </div>
    </header>
  );
}

function NoticeText({ notice }: Readonly<{ notice: { tone: "ok" | "error"; text: string } }>) {
  const error = notice.tone === "error";
  return (
    <span
      role={error ? "alert" : "status"}
      className={error ? "qbt:text-danger-strong" : "qbt:text-success"}
    >
      {notice.text}
    </span>
  );
}

function ConfirmBar({
  confirm,
  onCancel,
  onConfirm,
}: Readonly<{ confirm: Confirm; onCancel: () => void; onConfirm: () => void }>) {
  const t = useT();
  const prompt = confirmText(confirm, t);
  return (
    <div
      role="alertdialog"
      aria-labelledby="qbt-confirm-title"
      className="qbt:my-3 qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-3 qbt:rounded-lg qbt:border qbt:border-line qbt:bg-surface qbt:px-4 qbt:py-3 qbt:shadow-xs"
    >
      <div className="qbt:min-w-0 qbt:flex-1">
        <p id="qbt-confirm-title" className="qbt:text-sm qbt:font-semibold qbt:text-fg">
          {prompt.title}
        </p>
        <p className="qbt:text-sm qbt:text-fg-muted">{prompt.body}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {t("workspace.cancel")}
      </Button>
      <Button
        size="sm"
        variant={confirm.type === "publish" ? "primary" : "danger"}
        onClick={onConfirm}
      >
        {prompt.action}
      </Button>
    </div>
  );
}

function ProblemList({
  issues,
  onFocus,
}: Readonly<{ issues: TemplateIssue[]; onFocus: (issue: TemplateIssue) => void }>) {
  const t = useT();
  if (issues.length === 0) return null;
  return (
    <section
      aria-label={t("workspace.problems")}
      className="qbt:my-3 qbt:rounded-lg qbt:border qbt:border-danger-line qbt:bg-danger-soft qbt:px-4 qbt:py-3"
    >
      <p className="qbt:text-sm qbt:font-semibold qbt:text-danger-strong">
        {t("workspace.problemCount", { count: issues.length })}
      </p>
      <ul className="qbt:mt-1 qbt:space-y-0.5">
        {issues.map((issue, i) => (
          <li key={`${issue.path.join(".")}-${String(i)}`}>
            <button
              type="button"
              className="qbt:text-left qbt:text-sm qbt:text-danger-strong qbt:hover:underline"
              onClick={() => {
                onFocus(issue);
              }}
            >
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The template editor page: editor, live preview, issues, save and publish. */
export function TemplateWorkspace(props: Readonly<WorkspaceProps>) {
  const { actions, canEdit } = props;
  const t = useT();
  const router = useRouter();
  const api = useRef<EditorApi | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<TemplateIssue[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<FeedbackErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const content = () => api.current?.getContent() ?? props.initialContent;

  const showIssues = (next: TemplateIssue[]) => {
    setIssues(next);
    api.current?.showIssues(next);
  };

  const reference = t("sample.reference");
  const refresh = useCallback(async () => {
    const id = ++request.current;
    const result = await actions.preview(
      api.current?.getContent() ?? props.initialContent,
      reference,
    );
    if (id !== request.current) return;
    if (result.ok) {
      setPreview(result.value.html);
      setPreviewError(null);
      setIssues(result.value.issues);
      api.current?.showIssues(result.value.issues);
    } else {
      setPreviewError(result.code);
    }
  }, [actions, props.initialContent, reference]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), DEBOUNCE_MS);
  }, [refresh]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => {
      globalThis.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  async function run<T>(
    action: () => Promise<ActionResult<T>>,
    done: (value: T) => string | null,
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (result.ok) {
        const text = done(result.value);
        if (text) setNotice({ tone: "ok", text });
        router.refresh();
      } else {
        setNotice({ tone: "error", text: t(`error.${result.code}`) });
        if (result.issues.length > 0) showIssues(result.issues);
      }
    } finally {
      setBusy(false);
    }
  }

  const replaceContent = (next: TemplateContent | null) => {
    if (next) api.current?.setContent(next);
    setDirty(false);
    void refresh();
  };

  const save = () =>
    run(
      () => actions.save(content()),
      (value) => {
        setDirty(false);
        showIssues(value.issues);
        return t("done.saved", { number: value.number });
      },
    );

  const confirmed = (current: Confirm) => {
    setConfirm(null);
    switch (current.type) {
      case "publish":
        return run(
          () => actions.publish(content()),
          (value) => {
            setDirty(false);
            showIssues([]);
            return t("done.published", { number: value.number });
          },
        );
      case "discard":
        return run(actions.discard, (value) => {
          replaceContent(value.content);
          return t("done.discarded");
        });
      case "archive":
        return run(actions.archive, () => t("done.archived"));
      default:
        return run(
          () => actions.restore(current.version.id),
          (value) => {
            replaceContent(value.content);
            return t("done.restored", { number: current.version.number });
          },
        );
    }
  };

  const pdf = () =>
    run(
      () => actions.pdf(content(), t("sample.reference")),
      (value) => {
        download(value.base64, value.fileName);
        return null;
      },
    );

  // Ctrl/Cmd+S saves the draft.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [canEdit]);

  return (
    <div className="qbt-workspace">
      <WorkspaceHeader
        {...props}
        dirty={dirty}
        busy={busy}
        onPdf={() => void pdf()}
        onSave={() => void save()}
        onConfirm={setConfirm}
      />
      <p aria-live="polite" className="qbt:min-h-5 qbt:text-sm">
        {notice ? <NoticeText notice={notice} /> : null}
      </p>
      {confirm ? (
        <ConfirmBar
          confirm={confirm}
          onCancel={() => {
            setConfirm(null);
          }}
          onConfirm={() => void confirmed(confirm)}
        />
      ) : null}
      <ProblemList issues={issues} onFocus={(issue) => api.current?.focusIssue(issue)} />

      <div className="qbt:grid qbt:gap-6 qbt:2xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <Suspense
          fallback={
            <Card>
              <CardBody>
                <p className="qbt:text-sm qbt:text-fg-muted">{t("workspace.loading")}</p>
              </CardBody>
            </Card>
          }
        >
          <TemplateEditor
            catalog={props.catalog}
            initialContent={props.initialContent}
            editable={canEdit}
            onReady={(ready) => {
              api.current = ready;
              void refresh();
            }}
            onChange={() => {
              setDirty(true);
              schedule();
            }}
          />
        </Suspense>
        <section aria-label={t("workspace.preview")} className="qbt:min-w-0">
          <h2 className="qbt:mb-2 qbt:text-sm qbt:font-semibold qbt:text-fg">
            {t("workspace.previewTitle")}
          </h2>
          {previewError ? (
            <p className="qbt:mb-2 qbt:text-sm qbt:text-danger-strong">
              {t(`error.${previewError}`)}
            </p>
          ) : null}
          {preview === null ? (
            <p className="qbt:text-sm qbt:text-fg-muted">{t("workspace.rendering")}</p>
          ) : (
            <iframe
              title={t("workspace.previewFrame")}
              sandbox=""
              srcDoc={preview}
              className="qbt:h-[75vh] qbt:w-full qbt:rounded-lg qbt:border qbt:border-line qbt:bg-surface-stronger"
            />
          )}
        </section>
      </div>

      <History
        versions={props.versions}
        canEdit={canEdit}
        onRestore={(version) => {
          setConfirm({ type: "restore", version });
        }}
      />
    </div>
  );
}

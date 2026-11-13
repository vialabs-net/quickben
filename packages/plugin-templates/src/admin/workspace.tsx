"use client";

import { Badge, Button, ButtonLink, Card, CardBody, CardHeader } from "@quickben/admin/ui";
import { useRouter } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import type { TemplateContent, TemplateIssue } from "../content";
import type { CatalogVariable } from "../kinds";
import type { VersionSummary } from "../service";
import type { ActionResult } from "./actions";
import type { EditorApi } from "./editor-types";

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
  preview: (content: unknown) => Promise<ActionResult<{ html: string; issues: TemplateIssue[] }>>;
  pdf: (content: unknown) => Promise<ActionResult<{ base64: string; fileName: string }>>;
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

const confirmText = (confirm: Confirm) => {
  switch (confirm.type) {
    case "publish":
      return {
        title: "Publish this version?",
        body: "New documents use it from now on. Documents made before do not change.",
        action: "Publish",
      };
    case "discard":
      return {
        title: "Discard the draft?",
        body: "The saved draft is deleted. The editor goes back to the published version.",
        action: "Discard draft",
      };
    case "archive":
      return {
        title: "Archive the published version?",
        body: "New documents then use the base template, or cannot be made when there is none.",
        action: "Archive",
      };
    default:
      return {
        title: `Restore version ${String(confirm.version.number)}?`,
        body: "Its text replaces the draft and any unsaved changes.",
        action: "Restore",
      };
  }
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

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
  if (versions.length === 0) return null;
  const tone = { draft: "amber", published: "green", archived: "neutral" } as const;
  return (
    <Card className="qbt:mt-6" role="region" aria-label="History">
      <CardHeader
        title="History"
        description="Published versions never change. Restore one to edit it again."
      />
      <ul className="qbt:divide-y qbt:divide-zinc-100">
        {versions.map((version) => (
          <li
            key={version.id}
            className="qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-3 qbt:px-5 qbt:py-2.5 qbt:text-sm"
          >
            <span className="qbt:w-10 qbt:font-medium qbt:text-zinc-900">v{version.number}</span>
            <Badge tone={tone[version.status]}>{version.status}</Badge>
            <span className="qbt:text-zinc-500">
              {formatDate(version.publishedAt ?? version.updatedAt)}
              {version.restoredFrom === null
                ? ""
                : ` · restored from v${String(version.restoredFrom)}`}
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
                Restore v{version.number}
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
  const ask = (confirm: Confirm) => () => {
    onConfirm(confirm);
  };
  return (
    <header className="qbt:mb-4 qbt:flex qbt:flex-wrap qbt:items-start qbt:justify-between qbt:gap-4">
      <div className="qbt:min-w-0">
        <ButtonLink href={back} variant="ghost" size="sm" className="qbt:-ml-3 qbt:mb-1">
          ← Templates
        </ButtonLink>
        <h1 className="qbt:text-2xl qbt:font-semibold qbt:tracking-tight qbt:text-zinc-900">
          {label}
        </h1>
        <p className="qbt:mt-2 qbt:flex qbt:flex-wrap qbt:gap-1">
          {published ? (
            <Badge tone="green">Published · v{published.number}</Badge>
          ) : (
            <Badge>Not published</Badge>
          )}
          {draft ? <Badge tone="amber">Draft · v{draft.number}</Badge> : null}
          {dirty ? <Badge tone="blue">Unsaved changes</Badge> : null}
        </p>
      </div>
      <div className="qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-2">
        {hasPdf ? (
          <Button variant="ghost" size="sm" onClick={onPdf} disabled={busy}>
            Download PDF
          </Button>
        ) : null}
        {canEdit && published ? (
          <Button variant="ghost" size="sm" onClick={ask({ type: "archive" })} disabled={busy}>
            Archive
          </Button>
        ) : null}
        {canEdit && draft ? (
          <Button variant="ghost" size="sm" onClick={ask({ type: "discard" })} disabled={busy}>
            Discard draft
          </Button>
        ) : null}
        {canEdit ? (
          <>
            <Button variant="secondary" size="sm" onClick={onSave} disabled={busy} title="Ctrl+S">
              Save draft
            </Button>
            <Button size="sm" onClick={ask({ type: "publish" })} disabled={busy}>
              Publish
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
      className={error ? "qbt:text-red-700" : "qbt:text-emerald-700"}
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
  const prompt = confirmText(confirm);
  return (
    <div
      role="alertdialog"
      aria-labelledby="qbt-confirm-title"
      className="qbt:my-3 qbt:flex qbt:flex-wrap qbt:items-center qbt:gap-3 qbt:rounded-lg qbt:border qbt:border-zinc-200 qbt:bg-white qbt:px-4 qbt:py-3 qbt:shadow-xs"
    >
      <div className="qbt:min-w-0 qbt:flex-1">
        <p id="qbt-confirm-title" className="qbt:text-sm qbt:font-semibold qbt:text-zinc-900">
          {prompt.title}
        </p>
        <p className="qbt:text-sm qbt:text-zinc-500">{prompt.body}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
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
  if (issues.length === 0) return null;
  return (
    <section
      aria-label="Problems"
      className="qbt:my-3 qbt:rounded-lg qbt:border qbt:border-red-200 qbt:bg-red-50 qbt:px-4 qbt:py-3"
    >
      <p className="qbt:text-sm qbt:font-semibold qbt:text-red-800">
        {issues.length === 1
          ? "1 problem blocks publishing"
          : `${String(issues.length)} problems block publishing`}
      </p>
      <ul className="qbt:mt-1 qbt:space-y-0.5">
        {issues.map((issue, i) => (
          <li key={`${issue.path.join(".")}-${String(i)}`}>
            <button
              type="button"
              className="qbt:text-left qbt:text-sm qbt:text-red-700 qbt:hover:underline"
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
  const router = useRouter();
  const api = useRef<EditorApi | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<TemplateIssue[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const content = () => api.current?.getContent() ?? props.initialContent;

  const showIssues = (next: TemplateIssue[]) => {
    setIssues(next);
    api.current?.showIssues(next);
  };

  const refresh = useCallback(async () => {
    const id = ++request.current;
    const result = await actions.preview(api.current?.getContent() ?? props.initialContent);
    if (id !== request.current) return;
    if (result.ok) {
      setPreview(result.value.html);
      setPreviewError(null);
      setIssues(result.value.issues);
      api.current?.showIssues(result.value.issues);
    } else {
      setPreviewError(result.message);
    }
  }, [actions, props.initialContent]);

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
        setNotice({ tone: "error", text: result.message });
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
        return `Draft v${String(value.number)} saved`;
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
            return `Version ${String(value.number)} published`;
          },
        );
      case "discard":
        return run(actions.discard, (value) => {
          replaceContent(value.content);
          return "Draft discarded";
        });
      case "archive":
        return run(actions.archive, () => "Published version archived");
      default:
        return run(
          () => actions.restore(current.version.id),
          (value) => {
            replaceContent(value.content);
            return `Version ${String(current.version.number)} is the draft now`;
          },
        );
    }
  };

  const pdf = () =>
    run(
      () => actions.pdf(content()),
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
                <p className="qbt:text-sm qbt:text-zinc-500">Loading editor…</p>
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
        <section aria-label="Preview" className="qbt:min-w-0">
          <h2 className="qbt:mb-2 qbt:text-sm qbt:font-semibold qbt:text-zinc-900">
            Preview with sample data
          </h2>
          {previewError ? (
            <p className="qbt:mb-2 qbt:text-sm qbt:text-red-700">{previewError}</p>
          ) : null}
          {preview === null ? (
            <p className="qbt:text-sm qbt:text-zinc-500">Rendering…</p>
          ) : (
            <iframe
              title="Document preview"
              sandbox=""
              srcDoc={preview}
              className="qbt:h-[75vh] qbt:w-full qbt:rounded-lg qbt:border qbt:border-zinc-200 qbt:bg-zinc-200"
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

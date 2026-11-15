"use server";

import { getQuickben, QuickbenError } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import { redirect } from "next/navigation";

import { toBase64 } from "../brand";
import { asContent } from "../content";
import { RendererUnavailableError } from "../pdf";
import { renderPdf, renderTemplate } from "../render";
import {
  archiveTemplate,
  discardDraft,
  getTemplate,
  getTemplateKind,
  publishTemplate,
  restoreVersion,
  saveBrand,
  saveDraft,
} from "../service";
import { validateContent } from "../validate";

import { brandInput } from "./brand-input";
import { editorContent } from "./editor-content";
import { errorCode, issuesOf } from "./feedback";
import { getTemplatesAdmin } from "./registry";

import type { TemplateContent, TemplateIssue } from "../content";
import type { FeedbackErrorCode } from "./feedback";
import type { Quickben, RequestContext } from "@quickben/core";

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  basePath: string;
}

async function scopeFor(key: unknown): Promise<Scope> {
  if (typeof key !== "string") throw new TypeError("Invalid templates admin request");
  const instance = getTemplatesAdmin(key);
  if (!instance) throw new Error("The admin is not ready on this server yet. Reload the page.");
  const qb = await getQuickben(instance.config);
  const ctx = await getRequestContext(instance.config);
  return { qb, ctx, basePath: instance.basePath };
}

/**
 * Result of a template action. Errors carry a fixed code (the admin shows the message
 * `templates.error.<code>`) and, for a refused publish, the issues.
 */
export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; code: FeedbackErrorCode; issues: TemplateIssue[] };

async function attempt<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (!(error instanceof QuickbenError) && !(error instanceof RendererUnavailableError)) {
      throw error;
    }
    return { ok: false, code: errorCode(error), issues: issuesOf(error) };
  }
}

/** Save the editor's content as the draft. */
export async function saveDraftAction(
  key: string,
  kind: string,
  content: unknown,
): Promise<ActionResult<{ number: number; issues: TemplateIssue[] }>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    const result = await saveDraft(qb, kind, content, ctx);
    return { number: result.draft.number, issues: result.issues };
  });
}

/** Save the content as the draft and publish it. */
export async function publishAction(
  key: string,
  kind: string,
  content: unknown,
): Promise<ActionResult<{ number: number }>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    const detail = await publishTemplate(qb, kind, ctx, { content });
    return { number: detail.published?.number ?? 0 };
  });
}

/** Delete the draft; returns the content to show next. */
export async function discardDraftAction(
  key: string,
  kind: string,
): Promise<ActionResult<{ content: TemplateContent | null }>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    await discardDraft(qb, kind, ctx);
    return { content: editorContent(qb, await getTemplate(qb, kind, ctx)) };
  });
}

/** Archive the published version. */
export async function archiveAction(key: string, kind: string): Promise<ActionResult<null>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    await archiveTemplate(qb, kind, ctx);
    return null;
  });
}

/** Copy a version into the draft; returns the draft content. */
export async function restoreAction(
  key: string,
  kind: string,
  versionId: string,
): Promise<ActionResult<{ content: TemplateContent | null }>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    const detail = await restoreVersion(qb, kind, versionId, ctx);
    return { content: detail.draft?.content ?? null };
  });
}

/** The reference printed on a preview: the admin's translation of "Preview". */
function previewReference(reference: unknown): string {
  return typeof reference === "string" && reference.trim() !== ""
    ? reference.trim().slice(0, 40)
    : "Preview";
}

/**
 * Issues and preview HTML of unsaved content, rendered with the kind's sample data.
 * `reference` is printed as the document reference (default `Preview`).
 */
export async function previewAction(
  key: string,
  kind: string,
  content: unknown,
  reference?: unknown,
): Promise<ActionResult<{ html: string; issues: TemplateIssue[] }>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    const resolved = getTemplateKind(qb, kind);
    const doc = asContent(content);
    const rendered = await renderTemplate(
      qb,
      {
        kind,
        data: resolved.sampleData,
        source: { content: doc },
        reference: previewReference(reference),
      },
      ctx,
    );
    return { html: rendered.preview, issues: validateContent(doc, resolved) };
  });
}

/** A PDF of unsaved content with sample data, as base64. */
export async function pdfAction(
  key: string,
  kind: string,
  content: unknown,
  reference?: unknown,
): Promise<ActionResult<{ base64: string; fileName: string }>> {
  const { qb, ctx } = await scopeFor(key);
  return attempt(async () => {
    const resolved = getTemplateKind(qb, kind);
    const result = await renderPdf(
      qb,
      {
        kind,
        data: resolved.sampleData,
        source: { content },
        reference: previewReference(reference),
      },
      ctx,
    );
    return { base64: toBase64(result.pdf), fileName: `${kind}-preview.pdf` };
  });
}

/** Save the brand form. Redirects back with `?toast=` or `?error=`. */
export async function saveBrandAction(key: string, formData: FormData): Promise<void> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const path = `${basePath}/brand`;
  let target = `${path}?toast=brand-saved`;
  try {
    await saveBrand(qb, await brandInput(qb, formData), ctx);
  } catch (error) {
    if (!(error instanceof QuickbenError)) throw error;
    target = `${path}?error=${errorCode(error)}`;
  }
  redirect(target);
}

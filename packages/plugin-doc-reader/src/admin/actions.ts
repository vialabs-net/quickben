"use server";

import { getQuickben, QuickbenError, ValidationError } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import { redirect } from "next/navigation";

import { removeQuota, setPlatformCap, setQuota } from "../quotas";
import { cancelReading, readDocument, retryReading } from "../readings";
import {
  addSample,
  createDocType,
  createDraft,
  deleteDraft,
  getVersion,
  publishDraft,
  removeSample,
  saveDraft,
  startTestRun,
  updateSample,
} from "../studio";

import { errorCode, issuePath } from "./feedback";
import {
  definitionFromForm,
  expectedFromForm,
  filesOf,
  paramsFromForm,
  text,
  variantFromForm,
} from "./forms";
import { getDocReaderAdmin } from "./registry";

import type { ToastCode } from "./feedback";
import type { Quickben, RequestContext } from "@quickben/core";

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  basePath: string;
}

async function scopeFor(key: unknown): Promise<Scope> {
  if (typeof key !== "string") throw new TypeError("Invalid doc reader admin request");
  const instance = getDocReaderAdmin(key);
  if (!instance) throw new Error("The admin is not ready on this server yet. Reload the page.");
  const qb = await getQuickben(instance.config);
  const ctx = await getRequestContext(instance.config);
  return { qb, ctx, basePath: instance.basePath };
}

function withQuery(path: string, query: Record<string, string>): string {
  const [base = "", existing = ""] = path.split("?");
  const params = new URLSearchParams(existing);
  for (const [name, value] of Object.entries(query)) params.set(name, value);
  return `${base}?${params.toString()}`;
}

/**
 * Run a change and say where to go next: `?toast=<code>` on success, `?error=<code>` (plus the
 * path of an invalid value) on a Quickben error. The pages map codes to fixed messages, so the
 * URL never carries text. `target` may depend on the change's result.
 */
async function attempt<T>(
  path: string,
  success: ToastCode,
  change: () => Promise<T>,
  target: (result: T) => string = () => path,
): Promise<string> {
  let result: T;
  try {
    result = await change();
  } catch (error) {
    if (!(error instanceof QuickbenError)) throw error;
    const issue = issuePath(error);
    return withQuery(path, { error: errorCode(error), ...(issue ? { issue } : {}) });
  }
  return withQuery(target(result), { toast: success });
}

function version(formData: FormData): number {
  return Number(text(formData, "version") ?? "0");
}

function typePath(basePath: string, key: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams(query).toString();
  const path = `${basePath}/document-types/${encodeURIComponent(key)}`;
  return params ? `${path}?${params}` : path;
}

// ---------------------------------------------------------------------------------------------
// Types and versions

export async function createTypeAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "key") ?? "";
  redirect(
    await attempt(
      `${scope.basePath}/document-types`,
      "type-created",
      () =>
        createDocType(scope.qb, scope.ctx, { key: typeKey, label: text(formData, "label") ?? "" }),
      (created) => typePath(scope.basePath, created.key),
    ),
  );
}

export async function createDraftAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const from = text(formData, "from");
  redirect(
    await attempt(
      typePath(scope.basePath, typeKey),
      "draft-created",
      () =>
        createDraft(scope.qb, scope.ctx, typeKey, from === undefined ? undefined : Number(from)),
      (draft) => typePath(scope.basePath, typeKey, { v: String(draft.version) }),
    ),
  );
}

export async function saveDraftAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const number = version(formData);
  const path = typePath(scope.basePath, typeKey, { v: String(number) });
  redirect(
    await attempt(path, "draft-saved", async () => {
      const current = await getVersion(scope.qb, scope.ctx, typeKey, number);
      return saveDraft(
        scope.qb,
        scope.ctx,
        typeKey,
        number,
        definitionFromForm(formData, current.definition),
      );
    }),
  );
}

export async function deleteDraftAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const number = version(formData);
  redirect(
    await attempt(
      typePath(scope.basePath, typeKey, { v: String(number) }),
      "draft-deleted",
      () => deleteDraft(scope.qb, scope.ctx, typeKey, number),
      () => (number > 1 ? typePath(scope.basePath, typeKey) : `${scope.basePath}/document-types`),
    ),
  );
}

export async function publishAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const number = version(formData);
  redirect(
    await attempt(
      typePath(scope.basePath, typeKey, { v: String(number), tab: "bench" }),
      "published",
      () => publishDraft(scope.qb, scope.ctx, typeKey, number),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Samples and test runs

export async function addSamplesAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const path = typePath(scope.basePath, typeKey, { v: String(version(formData)), tab: "bench" });
  const files = filesOf(formData, "files");
  if (files.length === 0) redirect(withQuery(path, { error: "no-file" }));
  redirect(
    await attempt(path, "samples-added", async () => {
      for (const file of files) await addSample(scope.qb, scope.ctx, typeKey, { file });
    }),
  );
}

export async function updateSampleAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const number = version(formData);
  const sampleId = text(formData, "sampleId") ?? "";
  const path = typePath(scope.basePath, typeKey, { v: String(number), tab: "bench" });
  redirect(
    await attempt(
      withQuery(path, { sample: sampleId }),
      "sample-saved",
      async () => {
        const current = await getVersion(scope.qb, scope.ctx, typeKey, number);
        return updateSample(scope.qb, scope.ctx, sampleId, {
          expected: expectedFromForm(formData, current.definition),
          params: paramsFromForm(formData, current.definition),
          note: text(formData, "note") ?? null,
        });
      },
      () => path,
    ),
  );
}

export async function removeSampleAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const path = typePath(scope.basePath, typeKey, { v: String(version(formData)), tab: "bench" });
  redirect(
    await attempt(path, "sample-removed", () =>
      removeSample(scope.qb, scope.ctx, text(formData, "sampleId") ?? ""),
    ),
  );
}

export async function startTestAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const typeKey = text(formData, "typeKey") ?? "";
  const number = version(formData);
  const path = typePath(scope.basePath, typeKey, { v: String(number), tab: "bench" });
  const compare = formData.get("mode") === "compare";
  redirect(
    await attempt(
      path,
      "test-started",
      () => {
        const variants = compare
          ? [variantFromForm(formData, "a"), variantFromForm(formData, "b")]
          : [];
        if (variants.some((variant) => variant === undefined)) {
          throw new ValidationError([{ path: "variants", message: "Choose two models" }]);
        }
        return startTestRun(scope.qb, scope.ctx, typeKey, number, {
          variants: variants.filter((variant) => variant !== undefined),
        });
      },
      (runs) => withQuery(path, { run: runs[0]?.id ?? "" }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Budgets

function amount(formData: FormData): number {
  const value = text(formData, "monthlyUsd");
  return value === undefined ? Number.NaN : Number(value);
}

export async function setBudgetAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const month = text(formData, "month");
  const usage = `${scope.basePath}/document-usage`;
  const path = month ? withQuery(usage, { month }) : usage;
  redirect(
    await attempt(path, "budget-saved", () =>
      setQuota(scope.qb, scope.ctx, text(formData, "tenant") ?? "", amount(formData)),
    ),
  );
}

export async function removeBudgetAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const path = `${scope.basePath}/document-usage`;
  redirect(
    await attempt(path, "budget-removed", () =>
      removeQuota(scope.qb, scope.ctx, text(formData, "tenant") ?? ""),
    ),
  );
}

export async function setCapAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const path = `${scope.basePath}/document-usage`;
  const cap = text(formData, "monthlyUsd") === undefined ? null : amount(formData);
  redirect(await attempt(path, "cap-saved", () => setPlatformCap(scope.qb, scope.ctx, cap)));
}

// ---------------------------------------------------------------------------------------------
// Readings

export async function retryReadingAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const id = text(formData, "id") ?? "";
  redirect(
    await attempt(
      `${scope.basePath}/document-queue/${encodeURIComponent(id)}`,
      "reading-retried",
      () => retryReading(scope.qb, id, scope.ctx),
    ),
  );
}

export async function cancelReadingAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const id = text(formData, "id") ?? "";
  redirect(
    await attempt(
      `${scope.basePath}/document-queue/${encodeURIComponent(id)}`,
      "reading-cancelled",
      () => cancelReading(scope.qb, id, scope.ctx),
    ),
  );
}

/** Read one document from the queue page, for staff trying a type. */
export async function tryReadingAction(key: string, formData: FormData): Promise<void> {
  const scope = await scopeFor(key);
  const path = `${scope.basePath}/document-queue`;
  const [file] = filesOf(formData, "file");
  if (!file) redirect(`${path}?error=no-file`);
  let id = "";
  try {
    id = (
      await readDocument(
        scope.qb,
        { type: text(formData, "type") ?? "auto", file, wait: 15_000 },
        scope.ctx,
      )
    ).id;
  } catch (error) {
    if (!(error instanceof QuickbenError)) throw error;
    redirect(withQuery(path, { error: errorCode(error) }));
  }
  redirect(`${path}/${encodeURIComponent(id)}`);
}

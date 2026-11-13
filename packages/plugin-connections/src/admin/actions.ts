"use server";

import { getQuickben, QuickbenError, ValidationError } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import { redirect } from "next/navigation";

import { testConnection, testCredential } from "../api";
import { ConnectionError } from "../errors";
import { CONNECTIONS, CREDENTIALS, getConnectionsOptions } from "../options";

import { describeProvider, metadataFromForm } from "./describe";
import { getConnectionsAdmin } from "./registry";

import type { TestOutcome } from "../api";
import type { FormState, TestView } from "./state";
import type { Quickben, RequestContext } from "@quickben/core";

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  basePath: string;
}

async function scopeFor(key: unknown): Promise<Scope> {
  if (typeof key !== "string") throw new TypeError("Invalid connections admin request");
  const instance = getConnectionsAdmin(key);
  if (!instance) throw new Error("The admin is not ready on this server yet. Reload the page.");
  const qb = await getQuickben(instance.config);
  const ctx = await getRequestContext(instance.config);
  return { qb, ctx, basePath: instance.basePath };
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : undefined;
}

const fixFields = "Check the highlighted fields.";

/** `metadata.models.0.id` → the form field `metadata.models`, message `0.id: …`. */
function fieldOf(path: string, message: string): [string, string] {
  const parts = path.split(".");
  if (parts[0] !== "metadata" || parts.length <= 2) return [path, message];
  return [parts.slice(0, 2).join("."), `${parts.slice(2).join(".")}: ${message}`];
}

/** Form state for a failed write. Errors that are not Quickben errors are thrown. */
function errorState(error: unknown): FormState {
  if (error instanceof ValidationError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const [field, message] = fieldOf(issue.path, issue.message);
      fieldErrors[field] ??= message;
    }
    const general = error.issues.find((issue) => issue.path === "");
    return { status: "error", message: general?.message ?? fixFields, fieldErrors };
  }
  if (error instanceof QuickbenError)
    return { status: "error", message: error.message, fieldErrors: {} };
  throw error;
}

/** Create or update a connection. Redirects to it on success. */
export async function saveConnectionAction(
  key: string,
  id: string | null,
  providerType: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const provider = getConnectionsOptions(qb).providers.get(providerType);
  if (!provider)
    return { status: "error", message: `Unknown provider type "${providerType}"`, fieldErrors: {} };
  const baseUrl = text(formData, "baseUrl");
  const credential = text(formData, "credential");
  const data = {
    name: text(formData, "name") ?? "",
    baseUrl: baseUrl === undefined || baseUrl === "" ? null : baseUrl,
    credential: credential === undefined || credential === "" ? null : credential,
    enabled: formData.get("enabled") === "on",
    metadata: metadataFromForm(describeProvider(provider).fields, formData),
  };
  let savedId: string;
  try {
    const saved =
      id === null
        ? await qb.create(CONNECTIONS, { ...data, providerType }, ctx)
        : await qb.update(CONNECTIONS, id, data, ctx);
    savedId = saved.id;
  } catch (error) {
    return errorState(error);
  }
  redirect(
    `${basePath}/${CONNECTIONS}/${encodeURIComponent(savedId)}?toast=${id === null ? "created" : "saved"}`,
  );
}

/** Create or update a credential. An empty secret keeps the stored one. */
export async function saveCredentialAction(
  key: string,
  id: string | null,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { qb, ctx, basePath } = await scopeFor(key);
  const secret = formData.get("secret");
  const data: Record<string, unknown> = {
    name: text(formData, "name") ?? "",
    kind: text(formData, "kind") ?? "api_key",
  };
  if (typeof secret === "string" && secret.trim() !== "") data.secret = secret;
  let savedId: string;
  try {
    const saved =
      id === null
        ? await qb.create(CREDENTIALS, data, ctx)
        : await qb.update(CREDENTIALS, id, data, ctx);
    savedId = saved.id;
  } catch (error) {
    return errorState(error);
  }
  redirect(
    `${basePath}/${CREDENTIALS}/${encodeURIComponent(savedId)}?toast=${id === null ? "created" : "saved"}`,
  );
}

/** Delete a connection or credential. A credential in use gives a 409 message. */
export async function deleteAction(key: string, slug: string, id: string): Promise<FormState> {
  const { qb, ctx, basePath } = await scopeFor(key);
  if (slug !== CONNECTIONS && slug !== CREDENTIALS) throw new TypeError("Invalid collection");
  try {
    await qb.delete(slug, id, ctx);
  } catch (error) {
    return errorState(error);
  }
  redirect(`${basePath}/${slug}?toast=deleted`);
}

function view(name: string, outcome: TestOutcome): TestView {
  const by = outcome.model === undefined ? "Answered" : `${outcome.model} answered`;
  return outcome.ok
    ? {
        status: "done",
        ok: true,
        title: `${name} works`,
        message: `${by} in ${String(outcome.latencyMs)} ms.`,
      }
    : {
        status: "done",
        ok: false,
        title: `${name} failed`,
        message: outcome.error ?? "The provider gave no detail.",
      };
}

async function runTest(name: string, run: () => Promise<TestOutcome>): Promise<TestView> {
  try {
    return view(name, await run());
  } catch (error) {
    if (error instanceof ConnectionError && error.reason === "pick-provider") {
      return { status: "pick-provider", message: error.message };
    }
    if (error instanceof QuickbenError) return { status: "error", message: error.message };
    throw error;
  }
}

/** "Test" on a connection. Stores the outcome in `lastTest`. */
export async function testConnectionAction(key: string, id: string): Promise<TestView> {
  const { qb, ctx } = await scopeFor(key);
  return runTest("The connection", () => testConnection(qb, id, ctx));
}

/** "Test" on a credential, against a provider (and URL) or the one of its first connection. */
export async function testCredentialAction(
  key: string,
  id: string,
  input: { providerType?: string; baseUrl?: string },
): Promise<TestView> {
  const { qb, ctx } = await scopeFor(key);
  const providerType = input.providerType?.trim();
  const baseUrl = input.baseUrl?.trim();
  return runTest("The credential", () =>
    testCredential(qb, id, ctx, {
      ...(providerType ? { providerType } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    }),
  );
}

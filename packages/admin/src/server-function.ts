import { getQuickben } from "@quickben/core";
import { collectionMeta, getRequestContext } from "@quickben/next";

import { fieldErrorsState, toFormState } from "./action-errors";
import { parseFormData } from "./form-data";
import { documentTitle } from "./format";
import { resolveAdminI18nData } from "./i18n/resolve";
import { createAdminI18n } from "./i18n/translator";
import { searchField } from "./list-query";

import type { AdminI18nOptions } from "./i18n/resolve";
import type { AdminI18n } from "./i18n/translator";
import type { AdminRequest, AdminResult } from "./types";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { CollectionMeta } from "@quickben/next";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Check the shape of a request. Server functions can be called with any arguments. */
function parseRequest(value: unknown): AdminRequest {
  if (!isRecord(value) || typeof value.slug !== "string")
    throw new TypeError("Invalid admin request");
  const { type, slug, id } = value;
  if (
    type === "save" &&
    (id === null || typeof id === "string") &&
    value.formData instanceof FormData
  ) {
    return { type, slug, id, formData: value.formData };
  }
  if (type === "delete" && typeof id === "string") return { type, slug, id };
  if (type === "search" && typeof value.query === "string")
    return { type, slug, query: value.query };
  throw new TypeError("Invalid admin request");
}

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  meta: CollectionMeta;
  i18n: AdminI18n;
}

async function search(
  { qb, ctx, meta }: Scope,
  request: Extract<AdminRequest, { type: "search" }>,
): Promise<AdminResult> {
  const text = request.query.trim().slice(0, 200);
  const field = searchField(meta);
  const result = await qb.find(
    request.slug,
    {
      ...(field && text !== "" ? { where: { [field.name]: { contains: text } } } : {}),
      ...(field ? { sort: field.name } : {}),
      limit: 10,
    },
    ctx,
  );
  return {
    status: "options",
    options: result.docs.map((doc) => ({ id: doc.id, label: documentTitle(meta, doc) })),
  };
}

async function remove(
  { qb, ctx, i18n }: Scope,
  request: Extract<AdminRequest, { type: "delete" }>,
): Promise<AdminResult> {
  try {
    await qb.delete(request.slug, request.id, ctx);
    return { status: "ok", id: request.id };
  } catch (error) {
    return toFormState(error, [], i18n);
  }
}

async function save(
  { qb, ctx, meta, i18n }: Scope,
  request: Extract<AdminRequest, { type: "save" }>,
): Promise<AdminResult> {
  const operation = request.id === null ? "create" : "update";
  const { data, errors } = parseFormData(meta.fields, request.formData, i18n, operation);
  if (Object.keys(errors).length > 0) return fieldErrorsState(errors, i18n);
  try {
    const doc =
      request.id === null
        ? await qb.create(request.slug, data, ctx)
        : await qb.update(request.slug, request.id, data, ctx);
    return { status: "ok", id: doc.id };
  } catch (error) {
    return toFormState(
      error,
      meta.fields.map((field) => field.name),
      i18n,
      meta.fields.filter((field) => field.rows !== undefined).map((field) => field.name),
    );
  }
}

/**
 * Run an admin request with the local API, as the current user. Call it from the server
 * function you pass to `createAdminPage`:
 *
 * ```tsx
 * async function serverFunction(request: AdminRequest) {
 *   "use server";
 *   return handleAdminRequest(config, request);
 * }
 * export default createAdminPage(config, { serverFunction });
 * ```
 *
 * Messages use the locale of `admin.locale` in the config. Pass the same `locale`,
 * `messages` and `timeZone` as to `createAdminPage` when you set them there.
 */
export async function handleAdminRequest(
  config: QuickbenConfig,
  input: AdminRequest,
  options: AdminI18nOptions = {},
): Promise<AdminResult> {
  const request = parseRequest(input);
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const i18n = createAdminI18n(await resolveAdminI18nData(config, options, ctx.req));
  const collection = Object.hasOwn(qb.collections, request.slug)
    ? qb.collections[request.slug]
    : undefined;
  const meta = collection ? await collectionMeta(collection, ctx, { locale: i18n.locale }) : null;
  if (!meta) {
    return request.type === "search"
      ? { status: "options", options: [] }
      : { status: "error", message: i18n.t("access.thisCollection"), fieldErrors: {} };
  }
  const scope = { qb, ctx, meta, i18n };
  switch (request.type) {
    case "search":
      return search(scope, request);
    case "delete":
      return remove(scope, request);
    case "save":
      return save(scope, request);
  }
}

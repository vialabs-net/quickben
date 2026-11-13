import { getQuickben } from "@quickben/core";
import { collectionMeta, getRequestContext } from "@quickben/next";

import { fieldErrorsState, toFormState } from "./action-errors";
import { parseFormData } from "./form-data";
import { documentTitle } from "./format";
import { searchField } from "./list-query";

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

const notReadable: AdminResult = {
  status: "error",
  message: "You cannot access this collection.",
  fieldErrors: {},
};

interface Scope {
  qb: Quickben;
  ctx: RequestContext;
  meta: CollectionMeta;
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
  { qb, ctx }: Scope,
  request: Extract<AdminRequest, { type: "delete" }>,
): Promise<AdminResult> {
  try {
    await qb.delete(request.slug, request.id, ctx);
    return { status: "ok", id: request.id };
  } catch (error) {
    return toFormState(error, []);
  }
}

async function save(
  { qb, ctx, meta }: Scope,
  request: Extract<AdminRequest, { type: "save" }>,
): Promise<AdminResult> {
  const { data, errors } = parseFormData(meta.fields, request.formData);
  if (Object.keys(errors).length > 0) return fieldErrorsState(errors);
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
 */
export async function handleAdminRequest(
  config: QuickbenConfig,
  input: AdminRequest,
): Promise<AdminResult> {
  const request = parseRequest(input);
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const collection = Object.hasOwn(qb.collections, request.slug)
    ? qb.collections[request.slug]
    : undefined;
  const meta = collection ? await collectionMeta(collection, ctx) : null;
  if (!meta) return request.type === "search" ? { status: "options", options: [] } : notReadable;
  const scope = { qb, ctx, meta };
  switch (request.type) {
    case "search":
      return search(scope, request);
    case "delete":
      return remove(scope, request);
    case "save":
      return save(scope, request);
  }
}

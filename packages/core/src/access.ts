import { ForbiddenError, UnauthorizedError } from "./errors";
import { normalizeWhere } from "./where";

import type { WhereNode } from "./adapter";
import type { AccessArgs, AccessOperation, RequestContext, SanitizedCollection } from "./types";

/** Access when a collection does not define a rule: authenticated users only. */
export function defaultAccess({ user }: AccessArgs): boolean {
  return user !== null;
}

/** Result of an access check: `true` = no restriction, `false` = denied, or a filter. */
export type AccessResult = true | false | WhereNode;

/**
 * Evaluate the access rule of `operation` for a collection, without reading or writing data.
 * `overrideAccess` skips it. A missing rule allows authenticated users only.
 *
 * The local API calls this for you. UI and HTTP layers call it to decide what to show, e.g.
 * hide a "Create" button when the result is `false`. A filter result means "allowed for the
 * documents that match it".
 */
export async function checkAccess(
  collection: SanitizedCollection,
  operation: AccessOperation,
  ctx: RequestContext,
  details: { id?: string; data?: Readonly<Record<string, unknown>> } = {},
): Promise<AccessResult> {
  if (ctx.overrideAccess === true) return true;
  const rule = collection.access[operation] ?? defaultAccess;
  const result = await rule({
    user: ctx.user,
    req: ctx.req,
    operation,
    id: details.id,
    data: details.data,
  });
  if (result === true || result === false) return result;
  return normalizeWhere(collection, result);
}

/** Error for a denied operation: `UnauthorizedError` without a user, else `ForbiddenError`. */
export function accessDenied(ctx: RequestContext, operation: AccessOperation, slug: string): Error {
  const message = `Not allowed to ${operation} in "${slug}"`;
  return ctx.user ? new ForbiddenError(message) : new UnauthorizedError(message);
}

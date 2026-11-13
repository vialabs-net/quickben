import { ForbiddenError, UnauthorizedError } from "./errors";
import { normalizeWhere } from "./where";

import type { WhereNode } from "./adapter";
import type {
  AccessArgs,
  AccessOperation,
  Quickben,
  RequestContext,
  SanitizedCollection,
} from "./types";

/** Access when a collection does not define a rule: authenticated users only. */
export function defaultAccess({ user }: AccessArgs): boolean {
  return user !== null;
}

/** Result of an access check: `true` = no restriction, `false` = denied, or a filter. */
export type AccessResult = true | false | WhereNode;

/** Evaluate the access rule of `operation`. `overrideAccess` skips it. */
export async function checkAccess(
  collection: SanitizedCollection,
  operation: AccessOperation,
  ctx: RequestContext,
  details: { id?: string; data?: Readonly<Record<string, unknown>>; qb?: Quickben } = {},
): Promise<AccessResult> {
  if (ctx.overrideAccess === true) return true;
  const rule = collection.access[operation] ?? defaultAccess;
  const result = await rule({
    user: ctx.user,
    req: ctx.req,
    ctx,
    qb: details.qb,
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

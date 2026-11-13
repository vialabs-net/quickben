"use server";

import { getAdmin } from "./registry";
import { handleAdminRequest } from "./server-function";

import type { AdminRequest, AdminResult } from "./types";

/**
 * Default server function, used when `createAdminPage` gets no `serverFunction`. It finds the
 * config in the registry that `createAdminPage` fills when the page module loads. After a
 * server restart (or on a new serverless instance) a form submitted from an open tab can
 * arrive before that, so production apps should pass their own `serverFunction`.
 */
export async function defaultServerFunction(
  key: string,
  request: AdminRequest,
): Promise<AdminResult> {
  if (typeof key !== "string") throw new TypeError("Invalid admin request");
  const instance = getAdmin(key);
  if (!instance) {
    return {
      status: "error",
      message: "The admin is not ready on this server yet. Reload the page and try again.",
      fieldErrors: {},
    };
  }
  return handleAdminRequest(instance.config, request);
}

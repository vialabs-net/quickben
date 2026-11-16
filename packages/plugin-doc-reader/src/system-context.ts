import type { RequestContext } from "@quickben/core";

/** Trusted server code: the plugin's own writes and background work. */
export const SYSTEM: RequestContext = { user: null, overrideAccess: true };

import { devAuth } from "@quickben/core";

import type { AuthAdapter } from "@quickben/core";

/**
 * Development auth. `devAuth()` reads the user from `QUICKBEN_DEV_USER` (see `.env.local`) or
 * from the `x-quickben-user` request header.
 *
 * In production every visitor is anonymous. Replace this with an `AuthAdapter` for your
 * identity provider before you deploy.
 */
export function appAuth(): AuthAdapter {
  if (process.env.NODE_ENV === "production") {
    return { getUser: () => Promise.resolve(null) };
  }
  return devAuth();
}

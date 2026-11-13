// Type stubs for packages that are not merged yet, written from the design brief so the docs
// samples for them typecheck. Delete each block when the real package lands in the workspace.

declare module "@quickben/plugin-tenancy" {
  import type { Plugin } from "@quickben/core";

  export function tenancy(options: { scope: readonly string[] }): Plugin;
}

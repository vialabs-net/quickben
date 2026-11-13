// Type stubs for packages that are not merged yet, written from the design brief so the docs
// samples for them typecheck. Delete each block when the real package lands in the workspace.

declare module "@quickben/db-drizzle" {
  import type { DatabaseAdapter } from "@quickben/core";

  export interface DrizzleAdapterOptions {
    dialect: "postgres" | "pglite" | "sqlite";
    /** Connection string, file path or `:memory:`. */
    url?: string;
  }
  export function drizzleAdapter(options: DrizzleAdapterOptions): DatabaseAdapter;
}

declare module "@quickben/next" {
  import type { QuickbenConfig, Registry } from "@quickben/core";

  type Handler = (
    req: Request,
    ctx: { params: Promise<{ quickben: string[] }> },
  ) => Promise<Response>;
  export function createRouteHandlers<R extends Registry>(
    config: QuickbenConfig<R>,
  ): { GET: Handler; POST: Handler; PATCH: Handler; DELETE: Handler };
}

declare module "@quickben/admin" {
  import type { QuickbenConfig, Registry } from "@quickben/core";
  import type { ReactNode } from "react";

  export function createAdminPage<R extends Registry>(
    config: QuickbenConfig<R>,
  ): (props: { params: Promise<{ segments?: string[] }> }) => Promise<ReactNode>;
}

import { vi } from "vitest";

import type { Mock } from "vitest";

/** Headers of the fake current request, read by `next/headers`. */
export const incoming = new Headers({ host: "localhost:3000" });

/** Fake Next.js router. */
export const router: Record<"push" | "refresh" | "replace", Mock<(href?: string) => void>> = {
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
};

/** Act as a user in server code. */
export function actAs(user: { id: string; roles?: string[] } | null): void {
  if (user) incoming.set("x-quickben-user", JSON.stringify(user));
  else incoming.delete("x-quickben-user");
}

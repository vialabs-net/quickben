import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { incoming, router } from "./mocks";

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(incoming),
  cookies: () => Promise.resolve({ getAll: () => [] }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => router,
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, ...props }: { href: string } & Record<string, unknown>) =>
      createElement("a", { href, ...props }),
  };
});

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
  router.push.mockClear();
  incoming.delete("x-quickben-user");
});

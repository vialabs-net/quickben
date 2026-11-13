import { vi } from "vitest";

import { incoming, jar, navigation } from "./next-mocks";

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(incoming),
  cookies: () =>
    Promise.resolve({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: (name: string, value: string, options?: { maxAge?: number }) => {
        if (options?.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      },
    }),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    navigation.redirects.push(href);
    throw new Error(`NEXT_REDIRECT ${href}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    navigation.revalidated.push(path);
  },
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, ...props }: { href: string } & Record<string, unknown>) =>
      createElement("a", { href, ...props }),
  };
});

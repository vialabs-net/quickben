import type { QuickbenUser } from "@quickben/core";

/** Headers of the fake current request. */
export const incoming = new Headers({ host: "localhost:3000" });

/** Cookies of the fake current request. */
export const jar = new Map<string, string>();

/** Redirects and revalidations done by server actions. */
export const navigation = { redirects: [] as string[], revalidated: [] as string[] };

/** Act as a user in server code, with a fresh cookie jar. */
export function actAs(user: QuickbenUser | null): void {
  // eslint-disable-next-line sonarjs/no-empty-collection -- filled by the cookie mock
  jar.clear();
  navigation.redirects.length = 0;
  navigation.revalidated.length = 0;
  if (user) incoming.set("x-quickben-user", JSON.stringify(user));
  else incoming.delete("x-quickben-user");
}

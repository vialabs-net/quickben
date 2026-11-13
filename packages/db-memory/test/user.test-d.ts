import { defineCollection, fields as f } from "@quickben/core";
import { expectTypeOf, test } from "vitest";

import type { AccessArgs, QuickbenUser } from "@quickben/core";

declare module "@quickben/core" {
  interface QuickbenUser {
    organizationId?: string;
  }
}

test("QuickbenUser can be extended with declaration merging", () => {
  expectTypeOf<QuickbenUser["organizationId"]>().toEqualTypeOf<string | undefined>();
  expectTypeOf<NonNullable<AccessArgs["user"]>>().toHaveProperty("organizationId");
  defineCollection({
    slug: "notes",
    fields: { organization: f.text() },
    access: { read: ({ user }) => ({ organization: { eq: user?.organizationId ?? "" } }) },
  });
});

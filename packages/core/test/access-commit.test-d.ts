import { describe, expectTypeOf, test } from "vitest";

import { defineCollection, fields as f, formatDateValue } from "../src";

import type { AfterCommitHook, FieldAccess, InferDoc, Quickben } from "../src";

describe("field access", () => {
  test("rules return booleans and leave document types alone", () => {
    const employees = defineCollection({
      slug: "employees",
      fields: {
        salary: f.number({ access: { read: ({ user }) => user !== null, update: () => false } }),
        hired: f.date({ timeZone: "America/Santiago" }),
      },
    });
    expectTypeOf<InferDoc<typeof employees>["salary"]>().toEqualTypeOf<number | null>();
    expectTypeOf(employees.fields.hired.timeZone).toEqualTypeOf<string | undefined>();
    // @ts-expect-error -- field rules cannot return filters
    const rules: FieldAccess = { read: () => ({ salary: { gt: 1 } }) };
    expectTypeOf(rules).toEqualTypeOf<FieldAccess>();
  });
});

describe("afterCommit", () => {
  test("hooks get the operation, documents and a local API", () => {
    const notes = defineCollection({
      slug: "notes",
      fields: { text: f.text({ required: true }) },
      hooks: {
        afterCommit: [
          ({ operation, doc, original, qb }) => {
            expectTypeOf(operation).toEqualTypeOf<"create" | "update" | "delete">();
            expectTypeOf(doc.text).toEqualTypeOf<string>();
            expectTypeOf(qb).toEqualTypeOf<Quickben>();
            if (operation === "create") expectTypeOf(original).toEqualTypeOf<null>();
            else expectTypeOf(original.text).toEqualTypeOf<string>();
          },
        ],
      },
    });
    expectTypeOf(notes.hooks.afterCommit).toEqualTypeOf<
      readonly AfterCommitHook<typeof notes.fields>[] | undefined
    >();
    expectTypeOf(formatDateValue("2026-01-01", { locale: "es" })).toEqualTypeOf<string>();
  });
});

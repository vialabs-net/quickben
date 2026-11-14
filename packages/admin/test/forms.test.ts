import { getQuickben } from "@quickben/core";
import { collectionMeta } from "@quickben/next";
import { describe, expect, it } from "vitest";

import * as forms from "../src/forms";
import { englishI18n } from "../src/i18n/translator";

import { admin, makeConfig } from "./fixtures";

const serverFunction = () => Promise.resolve({ status: "options" as const, options: [] });

describe("@quickben/admin/forms", () => {
  it("exports the field inputs and form parsing", () => {
    expect(Object.keys(forms).sort((a, b) => a.localeCompare(b))).toEqual([
      "controlId",
      "editableFields",
      "FieldInput",
      "formScope",
      "issuesToErrors",
      "loadFieldContext",
      "parseFormData",
    ]);
  });

  it("loadFieldContext labels selected relations and related collections", async () => {
    const qb = await getQuickben(makeConfig());
    const ctx = { user: admin };
    const author = await qb.create("authors", { name: "Ada" }, ctx);
    const meta = (await collectionMeta(qb.collections.posts, ctx))!;
    const context = await forms.loadFieldContext({
      qb,
      ctx,
      collection: meta,
      doc: { author: author.id, tags: ["missing"] },
      serverFunction,
      scope: forms.formScope("posts", "p1"),
      i18n: englishI18n,
    });
    expect(context.relationOptions.author).toEqual([{ id: author.id, label: "Ada" }]);
    expect(context.relationOptions.tags).toEqual([{ id: "missing", label: "missing" }]);
    expect(Object.keys(context.labels).sort((a, b) => a.localeCompare(b))).toEqual(["authors", "tags"]);
    expect(context).toMatchObject({ readOnly: false, scope: "posts-p1", components: {} });
  });

  it("skips relations to unknown collections", async () => {
    const qb = await getQuickben(makeConfig());
    const ctx = { user: admin };
    const meta = (await collectionMeta(qb.collections.posts, ctx))!;
    const broken = {
      ...meta,
      fields: meta.fields.map((field) =>
        field.name === "author" ? { ...field, to: "nope" } : field,
      ),
    };
    const context = await forms.loadFieldContext({
      qb,
      ctx,
      collection: broken,
      doc: null,
      serverFunction,
      scope: "x",
      i18n: englishI18n,
      readOnly: true,
    });
    expect(context.labels.nope).toBeUndefined();
    expect(context.readOnly).toBe(true);
  });
});

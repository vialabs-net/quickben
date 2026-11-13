import { getQuickben } from "@quickben/core";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultServerFunction } from "../src/actions";
import { registerAdmin } from "../src/registry";
import { handleAdminRequest } from "../src/server-function";

import { admin, editor, makeConfig } from "./fixtures";
import { actAs } from "./mocks";

import type { AdminRequest } from "../src";
import type { QuickbenConfig } from "@quickben/core";

const system = { user: null, overrideAccess: true };
let config: QuickbenConfig;

beforeEach(() => {
  config = makeConfig();
});

function save(slug: string, id: string | null, entries: Record<string, string>): AdminRequest {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.append(key, value);
  return { type: "save", slug, id, formData };
}

describe("handleAdminRequest", () => {
  it("creates and updates documents as the current user", async () => {
    actAs(editor);
    const created = await handleAdminRequest(
      config,
      save("posts", null, { title: "Hi", status: "draft" }),
    );
    expect(created).toMatchObject({ status: "ok" });
    const id = (created as { id: string }).id;
    const updated = await handleAdminRequest(
      config,
      save("posts", id, { title: "Bye", status: "published" }),
    );
    expect(updated).toEqual({ status: "ok", id });
    const qb = await getQuickben(config);
    expect(await qb.findById("posts", id, {}, system)).toMatchObject({
      title: "Bye",
      status: "published",
    });
  });

  it("returns field errors from the form and from validation", async () => {
    actAs(editor);
    expect(
      await handleAdminRequest(config, save("posts", null, { title: "", status: "draft" })),
    ).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { title: "Required" },
    });
    const long = await handleAdminRequest(
      config,
      save("posts", null, { title: "x".repeat(81), status: "draft" }),
    );
    expect(long).toMatchObject({ status: "error" });
    expect(long.status === "error" && typeof long.fieldErrors.title).toBe("string");
    const badRelation = await handleAdminRequest(
      config,
      save("posts", null, { title: "A", status: "draft", author: "missing" }),
    );
    expect(badRelation).toMatchObject({
      fieldErrors: { author: 'No "authors" document with id "missing"' },
    });
  });

  it("enforces access", async () => {
    actAs(null);
    expect(
      await handleAdminRequest(config, save("posts", null, { title: "A", status: "draft" })),
    ).toMatchObject({
      status: "error",
      message: 'Not allowed to create in "posts"',
    });
    expect(await handleAdminRequest(config, save("secrets", null, { value: "1" }))).toEqual({
      status: "error",
      message: "You cannot access this collection.",
      fieldErrors: {},
    });
    expect(await handleAdminRequest(config, save("nope", null, {}))).toMatchObject({
      status: "error",
    });
  });

  it("deletes documents", async () => {
    const qb = await getQuickben(config);
    const post = await qb.create("posts", { title: "Doomed" }, system);
    actAs(editor);
    expect(
      await handleAdminRequest(config, { type: "delete", slug: "posts", id: post.id }),
    ).toMatchObject({
      status: "error",
      message: 'Not allowed to delete in "posts"',
    });
    actAs(admin);
    expect(
      await handleAdminRequest(config, { type: "delete", slug: "posts", id: post.id }),
    ).toEqual({
      status: "ok",
      id: post.id,
    });
  });

  it("searches by title", async () => {
    const qb = await getQuickben(config);
    for (const name of ["Ann", "Bob", "Annie"]) await qb.create("authors", { name }, system);
    actAs(editor);
    const found = await handleAdminRequest(config, {
      type: "search",
      slug: "authors",
      query: " ann ",
    });
    expect(found).toMatchObject({ status: "options" });
    expect((found as { options: { label: string }[] }).options.map((o) => o.label)).toEqual([
      "Ann",
      "Annie",
    ]);
    const all = await handleAdminRequest(config, { type: "search", slug: "authors", query: "" });
    expect((all as { options: unknown[] }).options).toHaveLength(3);
    const secret = await handleAdminRequest(config, { type: "search", slug: "secrets", query: "" });
    expect(secret).toEqual({ status: "options", options: [] });
    const noTitle = await handleAdminRequest(config, { type: "search", slug: "logs", query: "x" });
    expect(noTitle).toEqual({ status: "options", options: [] });
  });

  it("rejects malformed requests", async () => {
    const bad = [
      null,
      { type: "save", slug: "posts", id: 1, formData: new FormData() },
      { type: "save", slug: "posts", id: null, formData: {} },
      { type: "delete", slug: "posts" },
      { type: "search", slug: "posts", query: 1 },
      { type: "other", slug: "posts" },
    ];
    for (const request of bad) {
      await expect(handleAdminRequest(config, request as never)).rejects.toThrow(
        "Invalid admin request",
      );
    }
  });
});

describe("defaultServerFunction", () => {
  it("uses the registered config", async () => {
    registerAdmin({ config, basePath: "/default-fn" });
    actAs(editor);
    const result = await defaultServerFunction("/default-fn", {
      type: "search",
      slug: "authors",
      query: "",
    });
    expect(result).toEqual({ status: "options", options: [] });
  });

  it("explains when the admin is not registered yet", async () => {
    const result = await defaultServerFunction("/unknown", {
      type: "search",
      slug: "authors",
      query: "",
    });
    expect(result.status === "error" && result.message).toContain("Reload the page");
    await expect(
      defaultServerFunction(1 as never, { type: "search", slug: "a", query: "" }),
    ).rejects.toThrow();
  });
});

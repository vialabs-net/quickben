// @vitest-environment happy-dom
import { defineCollection, defineConfig, devAuth, fields as f, getQuickben } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { collectionMeta } from "@quickben/next";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseFormData } from "../src/form-data";
import { createAdminI18n } from "../src/i18n/translator";
import { createAdminContent } from "../src/page";
import { handleAdminRequest } from "../src/server-function";

import { actAs } from "./mocks";

import type { AccessArgs } from "@quickben/core";

const isAdmin = ({ user }: AccessArgs) => user?.roles?.includes("admin") ?? false;
const editor = { id: "e1", roles: ["editor"] };
const system = { user: null, overrideAccess: true };

const people = defineCollection({
  slug: "people",
  fields: {
    name: f.text({ required: true }),
    salary: f.number({ access: { read: isAdmin, create: isAdmin, update: isAdmin } }),
    code: f.text({ access: { update: isAdmin } }),
    seenAt: f.datetime(),
  },
  access: { read: () => true, create: () => true, update: () => true },
  admin: { useAsTitle: "name", defaultColumns: ["name", "salary", "code"] },
});

const config = defineConfig({
  db: memoryAdapter(),
  collections: [people],
  auth: devAuth(),
  admin: { timeZone: "America/Santiago" },
});

const Page = createAdminContent(config, { basePath: "/admin" });
let id = "";

beforeAll(async () => {
  const qb = await getQuickben(config);
  id = (await qb.create("people", { name: "Ada", salary: 10, code: "A1" }, system)).id;
});

afterEach(cleanup);

async function renderPage(segments: string[]) {
  const element = await Page({
    params: Promise.resolve({ segments }),
    searchParams: Promise.resolve({}),
  });
  return render(element);
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("field access in the admin", () => {
  it("hides unreadable columns and inputs, and renders unwritable ones read-only", async () => {
    actAs(editor);
    await renderPage(["people"]);
    expect(screen.queryByRole("columnheader", { name: /Salary/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Code/ })).toBeTruthy();
    cleanup();
    await renderPage(["people", id]);
    expect(screen.queryByLabelText("Salary")).toBeNull();
    const code = screen.getByLabelText<HTMLInputElement>("Code");
    expect(code.disabled).toBe(true);
    expect(code.name).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).disabled).toBe(false);
    expect(screen.getByText("Time in America/Santiago.")).toBeTruthy();
    cleanup();
    await renderPage(["people", "new"]);
    expect(screen.getByLabelText<HTMLInputElement>("Code").disabled).toBe(false);
  });

  it("does not submit fields the user may not write", async () => {
    actAs(editor);
    const result = await handleAdminRequest(config, {
      type: "save",
      slug: "people",
      id,
      formData: form({ name: "Ada L.", code: "B2", seenAt: "2026-01-15T09:30" }),
    });
    expect(result).toEqual({ status: "ok", id });
    const qb = await getQuickben(config);
    expect(await qb.findById("people", id, {}, system)).toMatchObject({
      name: "Ada L.",
      code: "A1",
      salary: 10,
      // 09:30 in Santiago (UTC-3 in January).
      seenAt: "2026-01-15T12:30:00.000Z",
    });
  });

  it("parses forms per operation", async () => {
    const meta = await collectionMeta((await getQuickben(config)).collections.people, {
      user: editor,
    });
    const fields = meta?.fields ?? [];
    const i18n = createAdminI18n({ locale: "en", timeZone: "UTC", overrides: {} });
    expect(parseFormData(fields, form({ name: "A", code: "C" }), i18n, "create").data).toEqual({
      name: "A",
      code: "C",
      seenAt: null,
    });
    expect(parseFormData(fields, form({ name: "A", code: "C" }), i18n, "update").data).toEqual({
      name: "A",
      seenAt: null,
    });
  });
});

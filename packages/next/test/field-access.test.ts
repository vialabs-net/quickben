import { defineCollection, defineConfig, devAuth, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";

import { createRouteHandlers } from "../src";

import { admin, editor, request } from "./fixtures";

const isAdmin = ({ user }: { user: { roles?: string[] } | null }) =>
  user?.roles?.includes("admin") ?? false;

const people = defineCollection({
  slug: "people",
  fields: {
    name: f.text({ required: true }),
    salary: f.number({ access: { read: isAdmin, create: isAdmin, update: isAdmin } }),
    code: f.text({ access: { update: () => false } }),
    born: f.date({ timeZone: "America/Santiago" }),
  },
  access: { read: () => true, create: () => true, update: () => true },
  admin: { useAsTitle: "salary", defaultColumns: ["name", "salary"] },
});

const api = createRouteHandlers(
  defineConfig({ db: memoryAdapter(), collections: [people], auth: devAuth() }),
);

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("field access over HTTP", () => {
  it("hides unreadable fields in documents and rejects them in where and sort", async () => {
    const created = await api.POST(
      request("POST", "/api/people", { user: admin, body: { name: "Ada", salary: 10 } }),
    );
    expect(created.status).toBe(201);
    const id = String((await json(created)).id);
    const doc = await json(await api.GET(request("GET", `/api/people/${id}`, { user: editor })));
    expect(doc).not.toHaveProperty("salary");
    const where = encodeURIComponent(JSON.stringify({ salary: { gt: 1 } }));
    const filtered = await api.GET(request("GET", `/api/people?where=${where}`, { user: editor }));
    expect(filtered.status).toBe(400);
    const sorted = await api.GET(request("GET", "/api/people?sort=salary", { user: editor }));
    expect(sorted.status).toBe(400);
  });

  it("answers 403 with the denied fields", async () => {
    const response = await api.POST(
      request("POST", "/api/people", { user: editor, body: { name: "Bob", salary: 1 } }),
    );
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({
      error: { code: "FORBIDDEN", details: { fields: ["salary"] } },
    });
  });

  it("describes field access in /_meta", async () => {
    const meta = (await json(await api.GET(request("GET", "/api/_meta", { user: editor })))) as {
      collections: {
        fields: { name: string; access: unknown; timeZone?: string }[];
        admin: { useAsTitle: string; defaultColumns: string[] };
      }[];
    };
    const [collection] = meta.collections;
    expect(collection?.fields.map((field) => field.name)).toEqual(["name", "code", "born"]);
    expect(collection?.fields[1]?.access).toEqual({ create: true, update: false });
    expect(collection?.fields[2]?.timeZone).toBe("America/Santiago");
    expect(collection?.admin).toMatchObject({ useAsTitle: "id", defaultColumns: ["name"] });
  });
});

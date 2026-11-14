import {
  defineCollection,
  defineConfig,
  devAuth,
  fields as f,
  memoryStorage,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { beforeEach, describe, expect, it } from "vitest";

import { contentDisposition, createRouteHandlers, getMeta } from "../src";

import { editor } from "./fixtures";

import type { ErrorBody, RouteHandlers } from "../src";
import type { FileRef } from "@quickben/core";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const pdf = new TextEncoder().encode("%PDF-1.7 body");

function makeConfig() {
  const docs = defineCollection({
    slug: "docs",
    fields: {
      title: f.text(),
      logo: f.file({ accept: ["image/*"], maxBytes: 1024 }),
      contract: f.file(),
    },
    access: {
      read: ({ user }) => (user ? { title: { ne: "private" } } : false),
      create: () => true,
      update: () => true,
    },
  });
  return defineConfig({
    db: memoryAdapter(),
    storage: memoryStorage(),
    collections: [docs],
    auth: devAuth(),
  });
}

let api: RouteHandlers;
let config: ReturnType<typeof makeConfig>;

beforeEach(() => {
  config = makeConfig();
  api = createRouteHandlers(config, { maxUploadBytes: 4096 });
});

function multipart(
  method: string,
  path: string,
  parts: Record<string, string | Blob>,
  user: string | null = editor,
): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value === "string") form.append(name, value);
    else form.append(name, value, value instanceof File ? value.name : "blob");
  }
  return new Request(`http://localhost:3000${path}`, {
    method,
    body: form,
    headers: user ? { "x-quickben-user": user } : {},
  });
}

function get(path: string, headers: Record<string, string> = {}, user: string | null = editor) {
  return new Request(`http://localhost:3000${path}`, {
    headers: { ...(user ? { "x-quickben-user": user } : {}), ...headers },
  });
}

async function upload(parts: Record<string, string | Blob>) {
  const response = await api.POST(multipart("POST", "/api/docs", parts));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("multipart uploads", () => {
  it("creates a document with a file and JSON fields", async () => {
    const { status, body } = await upload({
      _payload: JSON.stringify({ title: "Hello", id: "chosen" }),
      logo: new File([png], "logo.png", { type: "image/png" }),
    });
    expect(status).toBe(201);
    expect(body.title).toBe("Hello");
    expect(body.id).not.toBe("chosen");
    expect(body.logo).toMatchObject({ name: "logo.png", mime: "image/png", size: png.length });
  });

  it("replaces a file with PATCH", async () => {
    const { body } = await upload({ logo: new File([png], "a.png") });
    const response = await api.PATCH(
      multipart("PATCH", `/api/docs/${String(body.id)}`, {
        contract: new File([pdf], "c.pdf"),
      }),
    );
    expect(response.status).toBe(200);
    const doc = (await response.json()) as Record<string, FileRef>;
    expect(doc.contract?.mime).toBe("application/pdf");
    expect(doc.logo?.name).toBe("a.png");
  });

  it("returns validation issues for bad files and parts", async () => {
    const wrongType = await upload({ logo: new File([pdf], "x.pdf") });
    expect(wrongType.status).toBe(400);
    expect((wrongType.body as unknown as ErrorBody).error.details?.issues).toEqual([
      expect.objectContaining({ path: "logo" }),
    ]);
    expect((await upload({ title: "loose" })).status).toBe(400);
    expect((await upload({ _payload: "{oops" })).status).toBe(400);
    expect((await upload({ _payload: "[1]" })).status).toBe(400);
    expect((await upload({ _payload: new File(["{}"], "p.json") })).status).toBe(400);
    const form = new FormData();
    form.append("logo", new File([png], "a.png"));
    form.append("logo", new File([png], "b.png"));
    const twice = await api.POST(
      new Request("http://localhost:3000/api/docs", {
        method: "POST",
        body: form,
        headers: { "x-quickben-user": editor },
      }),
    );
    expect(twice.status).toBe(400);
  });

  it("rejects broken and large bodies", async () => {
    const broken = await api.POST(
      new Request("http://localhost:3000/api/docs", {
        method: "POST",
        body: "nope",
        headers: { "content-type": "multipart/form-data; boundary=x", "x-quickben-user": editor },
      }),
    );
    expect(broken.status).toBe(400);
    // Send the encoded form as bytes: cancelling a FormData body stream errors in undici.
    const form = new FormData();
    form.append("contract", new File([new Uint8Array(5000)], "big.bin"));
    const encoded = new Response(form);
    const large = await api.POST(
      new Request("http://localhost:3000/api/docs", {
        method: "POST",
        body: await encoded.arrayBuffer(),
        headers: {
          "content-type": encoded.headers.get("content-type") ?? "",
          "x-quickben-user": editor,
        },
      }),
    );
    expect(large.status).toBe(413);
    const text = await api.POST(
      new Request("http://localhost:3000/api/docs", {
        method: "POST",
        body: "x",
        headers: { "content-type": "text/plain", "x-quickben-user": editor },
      }),
    );
    expect(text.status).toBe(415);
  });
});

describe("GET /:collection/:id/:field", () => {
  async function stored(title = "shown") {
    const { body } = await upload({
      _payload: JSON.stringify({ title }),
      logo: new File([png], "logo ñ.png"),
      contract: new File([pdf], 'con"tract.pdf'),
    });
    return String(body.id);
  }

  it("streams the file with safe headers", async () => {
    const id = await stored();
    const response = await api.GET(get(`/api/docs/${id}/logo`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(png.length));
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="logo _.png"; filename*=UTF-8''logo%20%C3%B1.png`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("sends attachments on request and keeps PDFs out of the sandbox", async () => {
    const id = await stored();
    const download = await api.GET(get(`/api/docs/${id}/contract?download`));
    expect(download.headers.get("content-disposition")).toMatch(
      /^attachment; filename="con_tract.pdf"/,
    );
    expect(download.headers.get("content-security-policy")).not.toContain("sandbox");
  });

  it("answers 304 for a matching ETag", async () => {
    const id = await stored();
    const first = await api.GET(get(`/api/docs/${id}/logo`));
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[\da-f]{64}"$/);
    const again = await api.GET(get(`/api/docs/${id}/logo`, { "if-none-match": etag }));
    expect(again.status).toBe(304);
  });

  it("follows the document's read access", async () => {
    const id = await stored("private");
    expect((await api.GET(get(`/api/docs/${id}/logo`))).status).toBe(404);
    expect((await api.GET(get(`/api/docs/${id}/logo`, {}, null))).status).toBe(401);
  });

  it("rejects unknown parameters, missing files and other methods", async () => {
    const id = await stored();
    expect((await api.GET(get(`/api/docs/${id}/logo?redirect=https://evil.test`))).status).toBe(
      400,
    );
    expect((await api.GET(get(`/api/docs/${id}/title`))).status).toBe(404);
    expect((await api.GET(get(`/api/docs/missing/logo`))).status).toBe(404);
    expect((await api.DELETE(get(`/api/docs/${id}/logo`))).status).toBe(405);
    expect((await api.GET(get(`/api/docs/${id}/logo/more`))).status).toBe(404);
  });
});

describe("file metadata", () => {
  it("describes accept and maxBytes", async () => {
    const { getQuickben } = await import("@quickben/core");
    const meta = await getMeta(await getQuickben(config), { user: { id: "u" } });
    const fields = meta.collections[0]?.fields ?? [];
    expect(fields.find((field) => field.name === "logo")).toMatchObject({
      type: "file",
      accept: ["image/*"],
      maxBytes: 1024,
    });
    expect(fields.find((field) => field.name === "contract")).not.toHaveProperty("accept");
  });

  it("encodes names for Content-Disposition", () => {
    expect(contentDisposition("attachment", "a\\b\n.txt")).toBe(
      `attachment; filename="a_b_.txt"; filename*=UTF-8''a%5Cb%0A.txt`,
    );
  });
});

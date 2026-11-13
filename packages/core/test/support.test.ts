import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkAccess,
  ConfigError,
  ConflictError,
  defineCollection,
  defineConfig,
  devAuth,
  fields,
  ForbiddenError,
  NotFoundError,
  QuickbenError,
  UnauthorizedError,
  ValidationError,
} from "../src";
import { uuidv7 } from "../src/id";

import { testAdapter } from "./helpers";

describe("errors", () => {
  it("carry stable codes and HTTP statuses", () => {
    const errors = [
      new UnauthorizedError(),
      new ForbiddenError(),
      new NotFoundError(),
      new ConflictError("taken", "email"),
      new ValidationError([{ path: "title", message: "Required" }]),
      new ConfigError("bad"),
    ];
    expect(
      errors.map((error) => [error.code, error.status, error instanceof QuickbenError]),
    ).toEqual([
      ["UNAUTHORIZED", 401, true],
      ["FORBIDDEN", 403, true],
      ["NOT_FOUND", 404, true],
      ["CONFLICT", 409, true],
      ["VALIDATION", 400, true],
      ["CONFIG", 500, true],
    ]);
    expect(errors[1]?.name).toBe("ForbiddenError");
    expect(new ConflictError("taken", "email").field).toBe("email");
    expect(errors[4]?.message).toBe("Validation failed. title: Required");
    expect(new ValidationError([{ path: "", message: "Expected an object" }]).message).toBe(
      "Validation failed. data: Expected an object",
    );
    expect(new ValidationError([]).message).toBe("Validation failed. Invalid data");
  });
});

describe("devAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const request = (headers: Record<string, string> = {}) =>
    new Request("https://example.com", { headers });

  it("reads a user id or JSON user from the header", async () => {
    const auth = devAuth();
    expect(await auth.getUser(request({ "x-quickben-user": "u1" }))).toEqual({ id: "u1" });
    expect(
      await auth.getUser(
        request({
          "x-quickben-user": '{"id":"u2","email":"a@b.co","roles":["admin",1],"org":"o1"}',
        }),
      ),
    ).toEqual({ id: "u2", email: "a@b.co", roles: ["admin"], org: "o1" });
  });

  it("returns null for missing or invalid users", async () => {
    const auth = devAuth({ header: "x-user" });
    expect(await auth.getUser(request())).toBeNull();
    expect(await auth.getUser(request({ "x-user": " " }))).toBeNull();
    expect(await auth.getUser(request({ "x-user": "{oops" }))).toBeNull();
    expect(await auth.getUser(request({ "x-user": '{"id":""}' }))).toBeNull();
    expect(await auth.getUser(request({ "x-user": '{"id":1}' }))).toBeNull();
  });

  it("falls back to an environment variable", async () => {
    vi.stubEnv("MY_USER", "env-user");
    expect(await devAuth({ env: "MY_USER" }).getUser(request())).toEqual({ id: "env-user" });
  });

  it("is disabled in production unless allowed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(devAuth().getUser(request({ "x-quickben-user": "u1" }))).rejects.toBeInstanceOf(
      ConfigError,
    );
    expect(
      await devAuth({ allowInProduction: true }).getUser(request({ "x-quickben-user": "u1" })),
    ).toEqual({
      id: "u1",
    });
  });
});

describe("uuidv7", () => {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("formats version 7 ids with the timestamp first", () => {
    const id = uuidv7(Date.UTC(2030, 0, 1));
    expect(id).toMatch(pattern);
    expect(Number.parseInt(id.replace("-", "").slice(0, 12), 16)).toBe(Date.UTC(2030, 0, 1));
  });

  it("is strictly increasing within the same millisecond", () => {
    const now = Date.UTC(2031, 0, 1);
    const ids = Array.from({ length: 5000 }, () => uuidv7(now));
    expect([...ids].sort((a, b) => (a < b ? -1 : 1))).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => pattern.test(id))).toBe(true);
  });

  it("never goes back in time", () => {
    const later = uuidv7(Date.UTC(2032, 0, 1));
    expect(uuidv7(Date.UTC(2020, 0, 1)) > later).toBe(true);
  });
});

describe("checkAccess", () => {
  it("evaluates a rule without touching data", async () => {
    const collection = defineConfig({
      db: testAdapter(),
      collections: [
        defineCollection({
          slug: "notes",
          fields: { owner: fields.text() },
          access: { read: ({ user }) => (user ? { owner: { eq: user.id } } : false) },
        }),
      ],
    }).collections[0]!;
    expect(await checkAccess(collection, "read", { user: null })).toBe(false);
    expect(await checkAccess(collection, "read", { user: { id: "u1" } })).toEqual({
      field: "owner",
      op: "eq",
      value: "u1",
    });
    expect(await checkAccess(collection, "create", { user: null })).toBe(false);
    expect(await checkAccess(collection, "create", { user: null, overrideAccess: true })).toBe(
      true,
    );
  });
});

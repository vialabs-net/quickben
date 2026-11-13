import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  apps: [] as { name: string }[],
  initializeApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  getAuth: vi.fn((appInstance: unknown) => ({ app: appInstance })),
}));

vi.mock("firebase-admin/app", () => ({
  getApps: () => app.apps,
  initializeApp: app.initializeApp,
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: app.getAuth }));

describe("defaultAdminAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    app.apps = [];
    app.initializeApp.mockClear();
  });

  it("creates the default app once there is none", async () => {
    const { defaultAdminAuth } = await import("../src/admin-sdk");
    expect(await defaultAdminAuth()).toEqual({ app: { name: "[DEFAULT]" } });
    expect(app.initializeApp).toHaveBeenCalledWith();
  });

  it("reuses an app the program created", async () => {
    app.apps = [{ name: "mine" }];
    const { defaultAdminAuth } = await import("../src/admin-sdk");
    expect(await defaultAdminAuth()).toEqual({ app: { name: "mine" } });
    expect(app.initializeApp).not.toHaveBeenCalled();
  });

  it("is used by firebaseAuth without `auth`", async () => {
    app.apps = [{ name: "mine" }];
    const { firebaseAuth } = await import("../src");
    const firebase = firebaseAuth();
    // The fake Auth has no methods: the call reaches it.
    await expect(firebase.revokeSessions("u1")).rejects.toThrow(TypeError);
  });

  it("explains a missing firebase-admin", async () => {
    vi.doMock("firebase-admin/auth", () => {
      throw new Error("Cannot find module");
    });
    const { defaultAdminAuth } = await import("../src/admin-sdk");
    await expect(defaultAdminAuth()).rejects.toMatchObject({ code: "CONFIG" });
  });
});

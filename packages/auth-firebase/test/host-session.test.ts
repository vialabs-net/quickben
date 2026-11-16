import { chainAuth, ConfigError, customAuth } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import { firebaseAuth } from "../src";

import { claims, fakeAdmin, firebaseError } from "./fake-admin";

import type { FirebaseUserRecord, HostSession } from "../src";

const record = (extra: Partial<FirebaseUserRecord> = {}): FirebaseUserRecord => ({
  uid: "u1",
  email: "ada@example.com",
  emailVerified: true,
  displayName: "Ada",
  photoURL: "https://example.com/ada.png",
  disabled: false,
  customClaims: { roles: ["admin"] },
  ...extra,
});

function setup(users: Record<string, FirebaseUserRecord | Error> = { u1: record() }) {
  const admin = fakeAdmin();
  const auth = {
    ...admin.auth,
    getUser: vi.fn((uid: string) => {
      const found = users[uid];
      if (found === undefined) return Promise.reject(firebaseError("auth/user-not-found"));
      return found instanceof Error ? Promise.reject(found) : Promise.resolve(found);
    }),
  };
  return { ...admin, auth };
}

/** The host's own opaque cookie, `sid=<uid>`. */
const session: HostSession = {
  read: (req) => /sid=(\w+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? null,
};

const withSid = (uid: string) =>
  new Request("http://localhost/", { headers: { cookie: `sid=${uid}` } });

describe("host session", () => {
  it("resolves the uid through the host and loads the user record", async () => {
    const { auth } = setup();
    const firebase = firebaseAuth({ auth, session });
    expect(await firebase.getUser(withSid("u1"))).toEqual({
      id: "u1",
      email: "ada@example.com",
      emailVerified: true,
      roles: ["admin"],
    });
    expect(auth.getUser).toHaveBeenCalledWith("u1");
    expect(await firebase.verify(withSid("u1"))).toMatchObject({
      name: "Ada",
      picture: "https://example.com/ada.png",
    });
    expect(auth.verifySessionCookie).not.toHaveBeenCalled();
  });

  it("ignores the Firebase session cookie", async () => {
    const { auth, cookies } = setup();
    cookies.set("c1", claims());
    const firebase = firebaseAuth({ auth, session });
    const req = new Request("http://localhost/", { headers: { cookie: "__session=c1" } });
    expect(await firebase.getUser(req)).toBeNull();
  });

  it("keeps bearer ID tokens", async () => {
    const { auth, idTokens } = setup();
    idTokens.set("t1", claims({ uid: "u2" }));
    const firebase = firebaseAuth({ auth, session, bearer: true });
    const req = new Request("http://localhost/", { headers: { authorization: "Bearer t1" } });
    expect((await firebase.getUser(req))?.id).toBe("u2");
    expect(await firebaseAuth({ auth, session }).getUser(req)).toBeNull();
  });

  it("treats disabled, unknown and missing users as anonymous", async () => {
    const { auth } = setup({ u1: record({ disabled: true }) });
    const firebase = firebaseAuth({ auth, session });
    expect(await firebase.getUser(withSid("u1"))).toBeNull();
    expect(await firebase.getUser(withSid("nobody"))).toBeNull();
    expect(await firebase.getUser(new Request("http://localhost/"))).toBeNull();
  });

  it("maps a minimal record", async () => {
    const { auth } = setup({ u1: { uid: "u1", emailVerified: false, disabled: false } });
    expect(await firebaseAuth({ auth, session }).getUser(withSid("u1"))).toEqual({
      id: "u1",
      emailVerified: false,
      roles: [],
    });
  });

  it("does not hide server errors", async () => {
    const { auth } = setup({ u1: new Error("network down") });
    await expect(firebaseAuth({ auth, session }).getUser(withSid("u1"))).rejects.toThrow(
      "network down",
    );
  });

  it.each(["auth/internal-error", "auth/insufficient-permission", "app/network-error"])(
    "does not grant a fallback user on a Firebase %s error",
    async (code) => {
      const error = firebaseError(code);
      const { auth } = setup({ u1: error });
      const fallback = vi.fn(() => ({ id: "fallback", roles: ["admin"] }));
      const chained = chainAuth(firebaseAuth({ auth, session }), customAuth({ getUser: fallback }));
      await expect(chained.getUser(withSid("u1"))).rejects.toBe(error);
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it("does not grant a fallback user when the host session reader fails", async () => {
    const { auth } = setup();
    const error = new Error("session store down");
    const fallback = vi.fn(() => ({ id: "fallback" }));
    const chained = chainAuth(
      firebaseAuth({ auth, session: { read: () => Promise.reject(error) } }),
      customAuth({ getUser: fallback }),
    );
    await expect(chained.getUser(withSid("u1"))).rejects.toBe(error);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(["cookie", "bearer"])(
    "does not grant a fallback user when %s verification has a server error",
    async (source) => {
      const { auth } = setup();
      const error = firebaseError("auth/internal-error");
      auth.verifySessionCookie.mockRejectedValue(error);
      auth.verifyIdToken.mockRejectedValue(error);
      const fallback = vi.fn(() => ({ id: "fallback" }));
      const chained = chainAuth(
        firebaseAuth({ auth, bearer: true }),
        customAuth({ getUser: fallback }),
      );
      const req = new Request("http://localhost/", {
        headers: source === "cookie" ? { cookie: "__session=c1" } : { authorization: "Bearer t1" },
      });
      await expect(chained.getUser(req)).rejects.toBe(error);
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it("uses the uid only with loadUser: false, and runs resolveUser", async () => {
    const { auth } = setup();
    const firebase = firebaseAuth({
      auth,
      session: { ...session, loadUser: false },
      resolveUser: (_claims, user) => ({ ...user, roles: ["member"] }),
    });
    expect(await firebase.getUser(withSid("u1"))).toEqual({
      id: "u1",
      emailVerified: false,
      roles: ["member"],
    });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("needs getUser on the Auth API unless loadUser is false", async () => {
    const { auth } = fakeAdmin();
    await expect(firebaseAuth({ auth, session }).getUser(withSid("u1"))).rejects.toThrow(
      ConfigError,
    );
  });
});

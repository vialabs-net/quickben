import { ConfigError } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import { firebaseAuth } from "../src";

import { claims, fakeAdmin, firebaseError, sessionRequest } from "./fake-admin";

function withCookie(value: string, name = "__session"): Request {
  return new Request("http://localhost:3000/admin", { headers: { cookie: `${name}=${value}` } });
}

async function signIn(
  firebase: ReturnType<typeof firebaseAuth>,
  body: unknown = { idToken: "t1" },
) {
  return firebase.handlers.POST(sessionRequest("POST", { body }));
}

async function errorOf(response: Response) {
  return (
    (await response.json()) as { error: { code: string; details: { reason: string } | null } }
  ).error;
}

describe("getUser", () => {
  it("is null without a cookie", async () => {
    const { auth } = fakeAdmin();
    const firebase = firebaseAuth({ auth });
    expect(await firebase.getUser(new Request("http://localhost/"))).toBeNull();
    expect(auth.verifySessionCookie).not.toHaveBeenCalled();
  });

  it("maps a valid session cookie to a user, with revocation check", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims({ roles: ["admin", 3, "editor"] }));
    const firebase = firebaseAuth({ auth });
    expect(await firebase.getUser(withCookie("c1"))).toEqual({
      id: "u1",
      email: "ada@example.com",
      emailVerified: true,
      roles: ["admin", "editor"],
    });
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("c1", true);
  });

  it("reads roles from another claim, a single string, or a resolver", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims({ role: "owner", email: undefined, email_verified: false }));
    const fromClaim = firebaseAuth({ auth, roles: "role", checkRevoked: false });
    expect(await fromClaim.getUser(withCookie("c1"))).toEqual({
      id: "u1",
      emailVerified: false,
      roles: ["owner"],
    });
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("c1", false);

    const resolver = firebaseAuth({ auth, roles: (c) => Promise.resolve([`uid:${c.uid}`]) });
    expect((await resolver.getUser(withCookie("c1")))?.roles).toEqual(["uid:u1"]);

    cookies.set("c2", claims({ roles: "" }));
    expect((await fromClaim.getUser(withCookie("c2")))?.roles).toEqual([]);
    cookies.set("c3", claims({ roles: { admin: true } }));
    expect((await fromClaim.getUser(withCookie("c3")))?.roles).toEqual([]);
  });

  it("uses resolveUser, and null makes the request anonymous", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims());
    const known = firebaseAuth({
      auth,
      resolveUser: (c, user) => (c.email === "ada@example.com" ? { ...user, id: "local-1" } : null),
    });
    expect((await known.getUser(withCookie("c1")))?.id).toBe("local-1");
    cookies.set("c2", claims({ email: "eve@example.com" }));
    expect(await known.getUser(withCookie("c2"))).toBeNull();
  });

  it("treats expired, revoked or malformed cookies as anonymous", async () => {
    const { auth, cookies, revoked } = fakeAdmin();
    const firebase = firebaseAuth({ auth });
    expect(await firebase.getUser(withCookie("nope"))).toBeNull();
    cookies.set("c1", claims());
    revoked.add("u1");
    expect(await firebase.getUser(withCookie("c1"))).toBeNull();
    expect(await firebase.getUser(withCookie("%E0%A4%A"))).toBeNull();
    expect(await firebase.getUser(withCookie(""))).toBeNull();
  });

  it("does not hide server errors", async () => {
    const { auth } = fakeAdmin();
    auth.verifySessionCookie.mockRejectedValueOnce(new Error("no credentials"));
    const firebase = firebaseAuth({ auth });
    await expect(firebase.getUser(withCookie("c1"))).rejects.toThrow("no credentials");
  });

  it("accepts bearer ID tokens only when enabled", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims());
    const req = () =>
      new Request("http://localhost/api/posts", { headers: { authorization: "Bearer t1" } });
    expect(await firebaseAuth({ auth }).getUser(req())).toBeNull();
    const bearer = firebaseAuth({ auth, bearer: true });
    expect((await bearer.getUser(req()))?.id).toBe("u1");
    const empty = new Request("http://localhost/", { headers: { authorization: "Bearer  " } });
    expect(await bearer.getUser(empty)).toBeNull();
    const basic = new Request("http://localhost/", { headers: { authorization: "Basic abc" } });
    expect(await bearer.getUser(basic)).toBeNull();
  });

  it("uses a custom cookie name and returns raw claims from verify", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims({ tier: "pro" }));
    const firebase = firebaseAuth({ auth, cookieName: "sid" });
    expect(firebase.cookieName).toBe("sid");
    expect((await firebase.verify(withCookie("c1", "sid")))?.tier).toBe("pro");
    expect(await firebase.verify(withCookie("c1"))).toBeNull();
  });
});

describe("POST (create session)", () => {
  it("verifies the ID token with revocation check and sets the cookie", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims({ roles: ["admin"] }));
    const firebase = firebaseAuth({ auth, sessionMaxAge: 3600 });
    const response = await signIn(firebase);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      user: { id: "u1", email: "ada@example.com", emailVerified: true, roles: ["admin"] },
    });
    expect(auth.verifyIdToken).toHaveBeenCalledWith("t1", true);
    expect(auth.createSessionCookie).toHaveBeenCalledWith("t1", { expiresIn: 3_600_000 });
    expect(response.headers.get("set-cookie")).toBe(
      "__session=session.t1.3600000; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
    );
  });

  it("sets a browser-session cookie when remember is false, Secure on https", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims());
    const firebase = firebaseAuth({
      auth,
      cookie: { domain: "example.com", sameSite: "strict", path: "/app" },
    });
    const response = await firebase.handlers.POST(
      sessionRequest("POST", {
        body: { idToken: " t1 ", remember: false },
        url: "http://app.example.com/api/auth/session",
        headers: { "x-forwarded-proto": "https", origin: "http://app.example.com" },
      }),
    );
    expect(response.headers.get("set-cookie")).toBe(
      "__session=session.t1.432000000; Path=/app; HttpOnly; SameSite=Strict; Domain=example.com; Secure",
    );
  });

  it("refuses other content types, large bodies and bad bodies", async () => {
    const { auth } = fakeAdmin();
    const firebase = firebaseAuth({ auth });
    const form = await firebase.handlers.POST(
      sessionRequest("POST", { body: "idToken=t1", headers: { "content-type": "text/plain" } }),
    );
    expect(form.status).toBe(415);
    const large = await signIn(firebase, { idToken: "x".repeat(20_000) });
    expect(large.status).toBe(413);
    for (const body of ["{", { idToken: "" }, { idToken: 1 }, { idToken: "t", remember: "yes" }]) {
      const response = await signIn(firebase, body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).details?.reason).toBe("invalid-request");
    }
    const none = await firebase.handlers.POST(
      sessionRequest("POST", { headers: { "content-type": "application/json" } }),
    );
    expect(none.status).toBe(400);
  });

  it("blocks cross-site requests", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims());
    const firebase = firebaseAuth({ auth });
    const response = await firebase.handlers.POST(
      sessionRequest("POST", {
        body: { idToken: "t1" },
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(auth.createSessionCookie).not.toHaveBeenCalled();
    const trusted = firebaseAuth({ auth, csrf: { trustedOrigins: ["https://app.example"] } });
    const ok = await trusted.handlers.POST(
      sessionRequest("POST", {
        body: { idToken: "t1" },
        headers: { origin: "https://app.example" },
      }),
    );
    expect(ok.status).toBe(200);
  });

  it("refuses invalid and revoked tokens and clears the old cookie", async () => {
    const { auth, idTokens, revoked } = fakeAdmin();
    const firebase = firebaseAuth({ auth });
    const invalid = await signIn(firebase);
    expect(invalid.status).toBe(401);
    expect(await errorOf(invalid)).toMatchObject({
      code: "UNAUTHORIZED",
      details: { reason: "invalid-token" },
    });
    expect(invalid.headers.get("set-cookie")).toContain("Max-Age=0");

    idTokens.set("t1", claims());
    revoked.add("u1");
    expect((await errorOf(await signIn(firebase))).details?.reason).toBe("revoked");
    auth.verifyIdToken.mockRejectedValueOnce(firebaseError("auth/user-disabled"));
    expect((await errorOf(await signIn(firebase))).details?.reason).toBe("revoked");
  });

  it("refuses an old sign-in", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims({ auth_time: Math.floor(Date.now() / 1000) - 600 }));
    const response = await signIn(firebaseAuth({ auth }));
    expect(response.status).toBe(401);
    expect((await errorOf(response)).details?.reason).toBe("stale-sign-in");
    expect((await signIn(firebaseAuth({ auth, maxAuthAge: 0 }))).status).toBe(200);
  });

  it("refuses unverified emails when required", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims({ email_verified: false }));
    expect((await signIn(firebaseAuth({ auth }))).status).toBe(200);
    const strict = await signIn(firebaseAuth({ auth, requireVerifiedEmail: true }));
    expect(strict.status).toBe(403);
    expect(await errorOf(strict)).toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "email-not-verified" },
    });
  });

  it("refuses accounts that resolveUser rejects", async () => {
    const { auth, idTokens } = fakeAdmin();
    idTokens.set("t1", claims());
    const response = await signIn(firebaseAuth({ auth, resolveUser: () => null }));
    expect(response.status).toBe(403);
    expect((await errorOf(response)).details?.reason).toBe("not-provisioned");
    expect(auth.createSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 500 for server errors", async () => {
    const { auth } = fakeAdmin();
    auth.verifyIdToken.mockRejectedValueOnce(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await signIn(firebaseAuth({ auth }));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("INTERNAL");
    log.mockRestore();
  });
});

describe("GET and DELETE", () => {
  it("returns the current user", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims());
    const firebase = firebaseAuth({ auth });
    const req = sessionRequest("GET", { headers: { cookie: "__session=c1" } });
    expect(await (await firebase.handlers.GET(req)).json()).toMatchObject({ user: { id: "u1" } });
    expect(await (await firebase.handlers.GET(sessionRequest("GET"))).json()).toEqual({
      user: null,
    });
  });

  it("clears the cookie without revoking by default", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims());
    const firebase = firebaseAuth({ auth });
    const response = await firebase.handlers.DELETE(
      sessionRequest("DELETE", { headers: { cookie: "__session=c1" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(
      "__session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("revokes refresh tokens with revokeOnSignOut", async () => {
    const { auth, cookies } = fakeAdmin();
    cookies.set("c1", claims());
    const firebase = firebaseAuth({ auth, revokeOnSignOut: true });
    await firebase.handlers.DELETE(
      sessionRequest("DELETE", { headers: { cookie: "__session=c1" } }),
    );
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("c1", false);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith("u1");
    // No cookie or an expired one: nothing to revoke.
    await firebase.handlers.DELETE(sessionRequest("DELETE"));
    await firebase.handlers.DELETE(
      sessionRequest("DELETE", { headers: { cookie: "__session=x" } }),
    );
    expect(auth.revokeRefreshTokens).toHaveBeenCalledTimes(1);
  });

  it("blocks cross-site sign-out", async () => {
    const { auth } = fakeAdmin();
    const response = await firebaseAuth({ auth }).handlers.DELETE(
      sessionRequest("DELETE", { headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(response.status).toBe(403);
  });
});

describe("options and loading", () => {
  it("checks sessionMaxAge", () => {
    for (const sessionMaxAge of [60, 15 * 24 * 3600, Number.NaN]) {
      expect(() => firebaseAuth({ sessionMaxAge })).toThrow(ConfigError);
    }
  });

  it("revokes sessions and loads auth from a function once", async () => {
    const { auth } = fakeAdmin();
    const load = vi.fn(() => Promise.resolve(auth));
    const firebase = firebaseAuth({ auth: load });
    await firebase.revokeSessions("u1");
    await firebase.revokeSessions("u2");
    expect(load).toHaveBeenCalledTimes(1);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith("u2");
  });

  it("retries a failed load", async () => {
    const { auth } = fakeAdmin();
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(auth);
    const firebase = firebaseAuth({ auth: load });
    await expect(firebase.revokeSessions("u1")).rejects.toThrow("offline");
    await firebase.revokeSessions("u1");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

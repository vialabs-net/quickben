// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const user = { uid: "fb-1", getIdToken: () => Promise.resolve("id-token") };
  return {
    user,
    apps: [] as { name: string }[],
    calls: [] as string[],
    initializeApp: vi.fn((_config: unknown, name: string) => ({ name })),
    getApp: vi.fn((name: string) => ({ name, existing: true })),
    getAuth: vi.fn((app: unknown) => ({ app })),
    signIn: vi.fn(() => Promise.resolve({ user })),
    signOut: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("firebase/app", () => ({
  getApps: () => sdk.apps,
  getApp: sdk.getApp,
  initializeApp: sdk.initializeApp,
}));

vi.mock("firebase/auth", () => {
  class GoogleAuthProvider {
    params: unknown = null;
    static credential(idToken: string) {
      return { idToken };
    }
    setCustomParameters(params: unknown) {
      this.params = params;
    }
  }
  return {
    GoogleAuthProvider,
    getAuth: sdk.getAuth,
    inMemoryPersistence: "NONE",
    setPersistence: vi.fn((_auth: unknown, persistence: string) => {
      sdk.calls.push(`persistence:${persistence}`);
      return Promise.resolve();
    }),
    signInWithPopup: vi.fn((_auth: unknown, provider: { params: unknown }) => {
      sdk.calls.push(`popup:${JSON.stringify(provider.params)}`);
      return sdk.signIn();
    }),
    signInWithCredential: vi.fn((_auth: unknown, credential: { idToken: string }) => {
      sdk.calls.push(`credential:${credential.idToken}`);
      return sdk.signIn();
    }),
    signInWithEmailAndPassword: vi.fn((_auth: unknown, email: string, password: string) => {
      sdk.calls.push(`password:${email}:${password}`);
      return sdk.signIn();
    }),
    signOut: () => {
      sdk.calls.push("signOut");
      return sdk.signOut();
    },
  };
});

const {
  createSessionClient,
  defaultIdentityKey,
  getFirebaseAuth,
  publishIdentity,
  SessionRequestError,
} = await import("../src/client");

const fetchMock = vi.fn<typeof fetch>();

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

beforeEach(() => {
  sdk.calls.length = 0;
  sdk.apps = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFirebaseAuth", () => {
  it("creates the app once per name", () => {
    getFirebaseAuth({ apiKey: "k" });
    expect(sdk.initializeApp).toHaveBeenCalledWith({ apiKey: "k" }, "[DEFAULT]");
    sdk.apps = [{ name: "[DEFAULT]" }];
    expect(getFirebaseAuth({ apiKey: "k" })).toEqual({
      app: { name: "[DEFAULT]", existing: true },
    });
  });
});

describe("createSessionClient", () => {
  const auth = { name: "auth" } as never;

  it("signs in with Google, posts the ID token and signs the client out", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { user: { id: "u1" } })));
    const client = createSessionClient({ auth });
    expect(await client.signInWithGoogle({ remember: false })).toEqual({ id: "u1" });
    expect(sdk.calls).toEqual(["persistence:NONE", 'popup:{"prompt":"select_account"}', "signOut"]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/session");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ idToken: "id-token", remember: false });
    expect(localStorage.getItem(defaultIdentityKey)).toBe("u1");
  });

  it("signs in with a One Tap credential or a password", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { user: { id: "u1" } })));
    const client = createSessionClient({ auth: () => Promise.resolve(auth), endpoint: "/s" });
    await client.signInWithGoogleIdToken("google-token");
    await client.signInWithPassword(" ada@example.com ", "pw");
    expect(sdk.calls).toContain("credential:google-token");
    expect(sdk.calls).toContain("password:ada@example.com:pw");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      remember: true,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/s");
  });

  it("uses firebaseConfig when no auth is given", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { user: { id: "u1" } })));
    await createSessionClient({ firebaseConfig: { apiKey: "k" } }).signInWithGoogle();
    expect(sdk.getAuth).toHaveBeenCalled();
    await expect(createSessionClient().signInWithGoogle()).rejects.toThrow("needs `auth`");
  });

  it("throws SessionRequestError with the server's reason", async () => {
    fetchMock.mockResolvedValue(
      reply(403, {
        error: { code: "FORBIDDEN", message: "No access", details: { reason: "not-provisioned" } },
      }),
    );
    const error: unknown = await createSessionClient({ auth })
      .signInWithGoogle()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionRequestError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", reason: "not-provisioned" });
    // The Firebase client is signed out even when the server refuses.
    expect(sdk.calls).toContain("signOut");
    expect(localStorage.getItem(defaultIdentityKey)).toBeNull();
  });

  it("copes with error bodies that are not JSON", async () => {
    fetchMock.mockResolvedValue(reply(502, "Bad gateway"));
    await expect(createSessionClient({ auth }).getSessionUser()).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL",
      reason: null,
      message: "Session request failed (502)",
    });
  });

  it("reads the session user and signs out", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user: { id: "u1" } }));
    const client = createSessionClient({ auth, identityKey: "k" });
    expect(await client.getSessionUser()).toEqual({ id: "u1" });
    localStorage.setItem("k", "u1");
    fetchMock.mockResolvedValueOnce(reply(200, { user: null }));
    await client.signOut();
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(localStorage.getItem("k")).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(403, { error: { code: "FORBIDDEN", message: "x" } }));
    await expect(client.signOut()).rejects.toBeInstanceOf(SessionRequestError);
  });

  it("ignores unavailable storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => {
      publishIdentity("k", "u1");
    }).not.toThrow();
    setItem.mockRestore();
  });
});

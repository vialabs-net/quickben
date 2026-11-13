// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionKeeper, useGoogleOneTap, useSessionKeeper } from "../src/client";

import type { GoogleAccountsId } from "../src/client";

type GsiWindow = typeof globalThis & { google?: { accounts?: { id?: GoogleAccountsId } } };

let visibility: DocumentVisibilityState = "visible";
/** Scripts the code tried to add. happy-dom does not load them. */
let scripts: HTMLScriptElement[] = [];

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function fakeGsi() {
  let callback: ((response: { credential: string }) => void) | undefined;
  const gsi = {
    initialize: vi.fn((config: { callback: (response: { credential: string }) => void }) => {
      callback = config.callback;
    }),
    prompt: vi.fn(),
    cancel: vi.fn(),
  };
  (globalThis as GsiWindow).google = { accounts: { id: gsi } };
  return { gsi, answer: (credential: string) => callback?.({ credential }) };
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  scripts = [];
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    scripts.push(node as HTMLScriptElement);
    return node;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as GsiWindow).google;
});

describe("useGoogleOneTap", () => {
  it("prompts while visible, cancels when hidden, and passes the credential", async () => {
    const { gsi, answer } = fakeGsi();
    const onCredential = vi.fn();
    const { unmount } = renderHook(() => {
      useGoogleOneTap({ clientId: "client-1", onCredential });
    });
    await flush();
    expect(gsi.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "client-1", context: "signin", auto_select: false }),
    );
    expect(gsi.prompt).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    expect(gsi.cancel).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(gsi.prompt).toHaveBeenCalledTimes(2);
    answer("google-id-token");
    expect(onCredential).toHaveBeenCalledWith("google-id-token");
    unmount();
    expect(gsi.cancel).toHaveBeenCalledTimes(2);
    answer("late");
    expect(onCredential).toHaveBeenCalledTimes(1);
  });

  it("does not prompt in a hidden tab, or without a client id, or when disabled", async () => {
    const { gsi } = fakeGsi();
    visibility = "hidden";
    renderHook(() => {
      useGoogleOneTap({ clientId: "c", onCredential: vi.fn() });
    });
    renderHook(() => {
      useGoogleOneTap({ clientId: undefined, onCredential: vi.fn() });
    });
    renderHook(() => {
      useGoogleOneTap({ clientId: "c", enabled: false, onCredential: vi.fn() });
    });
    await flush();
    expect(gsi.initialize).toHaveBeenCalledTimes(1);
    expect(gsi.prompt).not.toHaveBeenCalled();
  });

  it("stops when unmounted before the script loads", async () => {
    const { unmount } = renderHook(() => {
      useGoogleOneTap({ clientId: "c", onCredential: vi.fn() });
    });
    unmount();
    const { gsi } = fakeGsi();
    scripts[0]?.dispatchEvent(new Event("load"));
    await flush();
    expect(gsi.initialize).not.toHaveBeenCalled();
  });
});

describe("loadGoogleIdentity", () => {
  it("adds the script once and retries after a failure", async () => {
    // A fresh module: earlier tests left a loaded script behind.
    vi.resetModules();
    const { loadGoogleIdentity } = await import("../src/client/one-tap");
    const first = loadGoogleIdentity();
    expect(loadGoogleIdentity()).toBe(first);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe("https://accounts.google.com/gsi/client");
    scripts[0]?.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("did not load");

    const second = loadGoogleIdentity();
    expect(second).not.toBe(first);
    // Loaded, but the global is missing.
    scripts[1]?.dispatchEvent(new Event("load"));
    await expect(second).rejects.toThrow("did not load");

    const third = loadGoogleIdentity();
    const { gsi } = fakeGsi();
    scripts[2]?.dispatchEvent(new Event("load"));
    expect(await third).toBe(gsi);
    expect(await loadGoogleIdentity()).toBe(gsi);
  });
});

describe("useSessionKeeper", () => {
  function storage(key: string, newValue: string | null) {
    globalThis.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  }

  it("reports an account change from another tab once", () => {
    const onChange = vi.fn();
    renderHook(() => {
      useSessionKeeper({ userId: "u1", onChange });
    });
    storage("other", "u2");
    storage("quickben.auth.user", "u1");
    expect(onChange).not.toHaveBeenCalled();
    storage("quickben.auth.user", "u2");
    storage("quickben.auth.user", null);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("u2");
  });

  it("checks the server when the tab becomes visible, at most once per interval", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ user: { id: "u2" } })));
    vi.stubGlobal("fetch", fetchMock);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const onChange = vi.fn();
    renderHook(() => {
      useSessionKeeper({ userId: "u1", onChange, endpoint: "/s" });
    });
    setVisibility("visible");
    expect(fetchMock).not.toHaveBeenCalled();
    now.mockReturnValue(1_070_000);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/s", { credentials: "same-origin", cache: "no-store" });
    expect(onChange).toHaveBeenCalledWith("u2");
  });

  it("ignores failed checks and matching users", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(Response.json({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    renderHook(() => {
      useSessionKeeper({ userId: null, onChange, recheckInterval: 0 });
    });
    for (let i = 0; i < 3; i++) setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reloads by default (component form)", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const { container } = render(<SessionKeeper userId="u1" identityKey="k" />);
    expect(container.innerHTML).toBe("");
    storage("k", "u9");
    expect(reload).toHaveBeenCalled();
  });
});

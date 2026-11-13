// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as SessionClientModule from "../src/client/session-client";

const fake = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(),
  signInWithGoogleIdToken: vi.fn(),
  signInWithPassword: vi.fn(),
  options: [] as unknown[],
}));

vi.mock("next/link", () => ({ default: () => null }));
vi.mock("../src/client/session-client", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionClientModule>();
  return {
    ...actual,
    createSessionClient: (options: unknown) => {
      fake.options.push(options);
      return fake;
    },
  };
});

const { FirebaseSignInPage, safeRedirect, signInErrorMessage } = await import("../src/admin");
const { SessionRequestError } = await import("../src/client");

type GsiWindow = typeof globalThis & { google?: unknown };

const replace = vi.fn();
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  fake.options.length = 0;
  for (const fn of [fake.signInWithGoogle, fake.signInWithGoogleIdToken, fake.signInWithPassword]) {
    fn.mockReset().mockResolvedValue({ id: "u1" });
  }
  replace.mockReset();
  vi.stubGlobal("location", { search: "?next=/admin/posts", replace });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (globalThis as GsiWindow).google;
});

describe("FirebaseSignInPage", () => {
  it("signs in with Google and goes to ?next=", async () => {
    render(<FirebaseSignInPage firebaseConfig={{ apiKey: "k" }} endpoint="/s" />);
    expect(fake.options[0]).toEqual({ firebaseConfig: { apiKey: "k" }, endpoint: "/s" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await flush();
    expect(fake.signInWithGoogle).toHaveBeenCalledWith({ remember: true });
    expect(replace).toHaveBeenCalledWith("/admin/posts");
  });

  it("signs in with a password, without remembering, and ignores unsafe ?next=", async () => {
    vi.stubGlobal("location", { search: "?next=//evil.example", replace });
    render(
      <FirebaseSignInPage
        firebaseConfig={{ apiKey: "k" }}
        methods={["password"]}
        title="Staff"
        redirectTo="/home"
      />,
    );
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Keep me signed in"));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    await flush();
    expect(fake.signInWithPassword).toHaveBeenCalledWith("ada@example.com", "pw", {
      remember: false,
    });
    expect(replace).toHaveBeenCalledWith("/home");
  });

  it("shows the server's reason and allows another try", async () => {
    fake.signInWithGoogle.mockRejectedValueOnce(
      new SessionRequestError(403, "FORBIDDEN", "x", "not-provisioned"),
    );
    render(<FirebaseSignInPage firebaseConfig={{ apiKey: "k" }} showRemember={false} />);
    expect(screen.queryByLabelText("Keep me signed in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("no access");
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await flush();
    expect(replace).toHaveBeenCalledWith("/admin/posts");
  });

  it("signs in with One Tap when a client id is given", async () => {
    let callback: ((response: { credential: string }) => void) | undefined;
    (globalThis as GsiWindow).google = {
      accounts: {
        id: {
          initialize: (config: { callback: typeof callback }) => {
            callback = config.callback;
          },
          prompt: vi.fn(),
          cancel: vi.fn(),
        },
      },
    };
    render(<FirebaseSignInPage firebaseConfig={{ apiKey: "k" }} googleClientId="cid" />);
    await flush();
    act(() => {
      callback?.({ credential: "google-token" });
    });
    await flush();
    expect(fake.signInWithGoogleIdToken).toHaveBeenCalledWith("google-token", { remember: true });
  });
});

describe("signInErrorMessage", () => {
  it("maps server reasons and Firebase codes", () => {
    expect(
      signInErrorMessage(new SessionRequestError(401, "UNAUTHORIZED", "x", "stale-sign-in")),
    ).toMatch(/took too long/);
    expect(signInErrorMessage(new SessionRequestError(500, "INTERNAL", "x", null))).toBe(
      "Sign-in failed. Try again.",
    );
    expect(signInErrorMessage({ code: "auth/wrong-password" })).toBe("Wrong email or password.");
    expect(signInErrorMessage({ code: "auth/popup-closed-by-user" })).toBeNull();
    expect(signInErrorMessage(new Error("other"))).toBe("Sign-in failed. Try again.");
  });
});

describe("safeRedirect", () => {
  it("keeps local paths only", () => {
    expect(safeRedirect("/admin/posts?x=1#y", "/f")).toBe("/admin/posts?x=1#y");
    for (const next of [
      null,
      undefined,
      "",
      "https://evil.example",
      "//evil",
      "/\\evil",
      "/..//evil",
    ]) {
      expect(safeRedirect(next, "/f")).toBe("/f");
    }
  });
});

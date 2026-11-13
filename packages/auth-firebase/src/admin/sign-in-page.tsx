"use client";

import { Button, Card, CardBody, Checkbox, Input, Label } from "@quickben/admin/ui";
import { useMemo, useRef, useState } from "react";

import { useGoogleOneTap } from "../client/one-tap";
import { createSessionClient } from "../client/session-client";

import { safeRedirect, signInErrorMessage } from "./messages";

import type { FirebaseSessionClient } from "../client/session-client";
import type { FirebaseOptions } from "firebase/app";
import type { SubmitEvent } from "react";

/** Props of {@link FirebaseSignInPage}. All are plain values, so a server page can render it. */
export interface FirebaseSignInPageProps {
  /** Web config of the Firebase project. */
  firebaseConfig: FirebaseOptions;
  /** OAuth web client id for Google One Tap. Without it One Tap is off. */
  googleClientId?: string;
  /** Sign-in methods to offer. Default `["google"]`. */
  methods?: readonly ("google" | "password")[];
  /** Heading. Default `Sign in`. */
  title?: string;
  /** Where to go after sign-in when the URL has no safe `?next=`. Default `/admin`. */
  redirectTo?: string;
  /** URL of the session route. Default `/api/auth/session`. */
  endpoint?: string;
  /** Show a "Keep me signed in" checkbox. Default `true`. Without it sessions are remembered. */
  showRemember?: boolean;
}

type Action = "google" | "password" | "one-tap";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="qb:size-4">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.72-.06-1.25-.19-1.8H12v3.4h5.52c-.11.85-.69 2.12-1.98 2.98l2.79 2.24c1.74-1.58 2.74-3.91 2.74-6.82"
      />
      <path
        fill="#34A853"
        d="M12 21.9c2.7 0 4.97-.87 6.63-2.36l-3.16-2.43c-.85.58-1.98.98-3.47.98-2.64 0-4.88-1.71-5.68-4.07l-3.01 2.3C4.96 19.55 8.21 21.9 12 21.9"
      />
      <path
        fill="#FBBC05"
        d="M6.32 14.02A5.81 5.81 0 0 1 6 12c0-.7.12-1.38.31-2.02l-3-2.35A9.77 9.77 0 0 0 2.4 12c0 1.57.38 3.05 1.05 4.33z"
      />
      <path
        fill="#EA4335"
        d="M12 5.91c1.88 0 3.16.8 3.88 1.47l2.83-2.7C16.96 3.1 14.7 2.1 12 2.1c-3.79 0-7.04 2.35-8.69 5.58l3.01 2.3c.81-2.36 3.04-4.07 5.68-4.07"
      />
    </svg>
  );
}

/**
 * A sign-in page in the admin's style: Google (popup and One Tap) and email with password.
 * After sign-in it does a full page load to `?next=` (when it is a local path) or
 * `redirectTo`, so every server component renders with the new session.
 *
 * Import `@quickben/admin/styles.css` in the route's layout.
 */
export function FirebaseSignInPage(props: Readonly<FirebaseSignInPageProps>) {
  const {
    firebaseConfig,
    googleClientId,
    methods = ["google"],
    title = "Sign in",
    redirectTo = "/admin",
    endpoint,
    showRemember = true,
  } = props;
  const client: FirebaseSessionClient = useMemo(
    () => createSessionClient({ firebaseConfig, endpoint }),
    [firebaseConfig, endpoint],
  );
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const running = useRef(false);

  async function run(action: Action, signIn: () => Promise<unknown>) {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setError(null);
    try {
      await signIn();
      const next = new URLSearchParams(globalThis.location.search).get("next");
      globalThis.location.replace(safeRedirect(next, redirectTo));
    } catch (caught) {
      running.current = false;
      setBusy(null);
      setError(signInErrorMessage(caught));
    }
  }

  useGoogleOneTap({
    clientId: methods.includes("google") ? googleClientId : undefined,
    enabled: busy === null,
    onCredential: (idToken) => {
      void run("one-tap", () => client.signInWithGoogleIdToken(idToken, { remember }));
    },
  });

  function onPassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const email = text("email");
    const password = text("password");
    void run("password", () => client.signInWithPassword(email, password, { remember }));
  }

  return (
    <div className="qb-root qb:flex qb:min-h-screen qb:items-center qb:justify-center qb:bg-zinc-50 qb:px-4 qb:py-12">
      <Card className="qb:w-full qb:max-w-sm">
        <CardBody className="qb:flex qb:flex-col qb:gap-4">
          <h1 className="qb:text-2xl qb:font-semibold qb:text-zinc-900">{title}</h1>
          {error ? (
            <p
              role="alert"
              className="qb:rounded-md qb:bg-red-50 qb:px-3 qb:py-2 qb:text-sm qb:text-red-700"
            >
              {error}
            </p>
          ) : null}
          {methods.includes("google") ? (
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                void run("google", () => client.signInWithGoogle({ remember }));
              }}
            >
              <GoogleIcon />
              {busy === "google" || busy === "one-tap" ? "Signing in…" : "Continue with Google"}
            </Button>
          ) : null}
          {methods.includes("password") ? (
            <form className="qb:flex qb:flex-col qb:gap-3" onSubmit={onPassword}>
              <div className="qb:flex qb:flex-col qb:gap-1">
                <Label htmlFor="qb-sign-in-email">Email</Label>
                <Input
                  id="qb-sign-in-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="qb:flex qb:flex-col qb:gap-1">
                <Label htmlFor="qb-sign-in-password">Password</Label>
                <Input
                  id="qb-sign-in-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" disabled={busy !== null}>
                {busy === "password" ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          ) : null}
          {showRemember ? (
            <div className="qb:flex qb:items-center qb:gap-2">
              <Checkbox
                id="qb-sign-in-remember"
                checked={remember}
                onChange={(event) => {
                  setRemember(event.currentTarget.checked);
                }}
              />
              <Label htmlFor="qb-sign-in-remember">Keep me signed in</Label>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

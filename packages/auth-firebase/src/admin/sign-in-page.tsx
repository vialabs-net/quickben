"use client";

import { createAdminI18n, useAdminI18n } from "@quickben/admin/i18n";
import { Button, Card, CardBody, Checkbox, Input, Label } from "@quickben/admin/ui";
import { useMemo, useRef, useState } from "react";

import { useGoogleOneTap } from "../client/one-tap";
import { createSessionClient } from "../client/session-client";

import { firebaseAuthMessages, safeRedirect, signInErrorMessage } from "./messages";

import type { FirebaseSessionClient } from "../client/session-client";
import type { AdminI18n, AdminI18nData } from "@quickben/admin/i18n";
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
  /** Heading. Default `Sign in`, translated. */
  title?: string;
  /**
   * Locale data, e.g. `(await getAdminI18n(config)).data` in the server page, so the page
   * follows the admin locale and `admin.messages` overrides. Wins over `locale`.
   */
  i18n?: AdminI18nData;
  /** Locale such as `es`, when `i18n` is not given. Default: the admin provider's, else English. */
  locale?: string;
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
    title,
    i18n: data,
    locale,
    redirectTo = "/admin",
    endpoint,
    showRemember = true,
  } = props;
  const contextI18n = useAdminI18n();
  const i18n: AdminI18n = useMemo(() => {
    if (data) return createAdminI18n(data);
    if (locale) return createAdminI18n({ locale, timeZone: "UTC", overrides: {} });
    return contextI18n;
  }, [data, locale, contextI18n]);
  const t = i18n.scope(firebaseAuthMessages).t;
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
      setError(signInErrorMessage(caught, t));
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
    <div className="qb-root qb:flex qb:min-h-screen qb:items-center qb:justify-center qb:bg-surface-muted qb:px-4 qb:py-12">
      <Card className="qb:w-full qb:max-w-sm">
        <CardBody className="qb:flex qb:flex-col qb:gap-4">
          <h1 className="qb:text-2xl qb:font-semibold qb:text-fg">{title ?? t("title")}</h1>
          {error ? (
            <p
              role="alert"
              className="qb:rounded-md qb:bg-danger-soft qb:px-3 qb:py-2 qb:text-sm qb:text-danger-strong"
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
              {busy === "google" || busy === "one-tap" ? t("signingIn") : t("google")}
            </Button>
          ) : null}
          {methods.includes("password") ? (
            <form className="qb:flex qb:flex-col qb:gap-3" onSubmit={onPassword}>
              <div className="qb:flex qb:flex-col qb:gap-1">
                <Label htmlFor="qb-sign-in-email">{t("email")}</Label>
                <Input
                  id="qb-sign-in-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="qb:flex qb:flex-col qb:gap-1">
                <Label htmlFor="qb-sign-in-password">{t("password")}</Label>
                <Input
                  id="qb-sign-in-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" disabled={busy !== null}>
                {busy === "password" ? t("signingIn") : t("submit")}
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
              <Label htmlFor="qb-sign-in-remember">{t("remember")}</Label>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface CredentialResponse {
  credential: string;
}

/** The part of Google Identity Services (`google.accounts.id`) used here. */
export interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: "signin" | "signup" | "use";
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  prompt(): void;
  cancel(): void;
}

type GsiWindow = typeof globalThis & { google?: { accounts?: { id?: GoogleAccountsId } } };

let scriptPromise: Promise<GoogleAccountsId> | null = null;

function loaded(): GoogleAccountsId | undefined {
  return (globalThis as GsiWindow).google?.accounts?.id;
}

/** Load the Google Identity Services script once. A failed load is retried on the next call. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  const ready = loaded();
  if (ready) return Promise.resolve(ready);
  scriptPromise ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const id = loaded();
      if (id) resolve(id);
      else reject(new Error("Google Identity Services did not load"));
    };
    script.onerror = () => {
      reject(new Error("Google Identity Services did not load"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

/** Options of {@link useGoogleOneTap}. */
export interface GoogleOneTapOptions {
  /** OAuth web client id of the Firebase project. Without it nothing is shown. */
  clientId: string | undefined;
  /** Gets the Google ID token. Pass it to `signInWithGoogleIdToken`. */
  onCredential: (idToken: string) => void;
  /** Show the prompt. Turn it off while another sign-in runs. Default `true`. */
  enabled?: boolean;
  /** Wording of the prompt. Default `signin`. */
  context?: "signin" | "signup" | "use";
}

/**
 * Google One Tap: the "Continue as …" prompt (a FedCM dialog in recent browsers). It gives a
 * Google ID token without a popup window.
 *
 * The prompt shows only while the tab is visible and is cancelled when it is hidden: a prompt
 * left open in a forgotten tab would otherwise switch the account of every open tab. One Tap
 * is optional; when it cannot load, nothing happens.
 */
export function useGoogleOneTap(options: GoogleOneTapOptions): void {
  const { clientId, enabled = true, context = "signin" } = options;
  const callback = useRef(options.onCredential);
  useEffect(() => {
    callback.current = options.onCredential;
  });

  useEffect(() => {
    if (!enabled || !clientId) return;
    let cancelled = false;
    let gsi: GoogleAccountsId | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "visible") gsi?.prompt();
      else gsi?.cancel();
    };

    loadGoogleIdentity()
      .then((id) => {
        if (cancelled) return;
        gsi = id;
        id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!cancelled) callback.current(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: false,
          context,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        if (document.visibilityState === "visible") id.prompt();
        document.addEventListener("visibilitychange", onVisibility);
      })
      .catch(() => {
        // One Tap is optional: the regular sign-in buttons keep working.
      });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      gsi?.cancel();
    };
  }, [clientId, enabled, context]);
}

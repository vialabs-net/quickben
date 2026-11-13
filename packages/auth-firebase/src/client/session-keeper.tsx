"use client";

import { useEffect, useRef } from "react";

import { defaultIdentityKey, defaultSessionEndpoint } from "./session-client";

/** Options of {@link useSessionKeeper}. */
export interface SessionKeeperOptions {
  /** Id of the user this page was rendered for, or `null` when anonymous. */
  userId: string | null;
  /** URL of the session route. Default `/api/auth/session`. */
  endpoint?: string;
  /** Same key as the session client. Default `quickben.auth.user`. */
  identityKey?: string;
  /**
   * Called when the session now belongs to someone else (or no one). Default: reload the
   * page, so it renders for the current session.
   */
  onChange?: (userId: string | null) => void;
  /** Least time between two server checks when the tab becomes visible, in ms. Default 60 000. */
  recheckInterval?: number;
}

function reload(): void {
  globalThis.location.reload();
}

/**
 * Keeps an open page in step with the session cookie, which all tabs share.
 *
 * - Another tab signs in as someone else or signs out: the `storage` event fires at once.
 * - The session ended elsewhere (expired, revoked, other device): checked with `GET` on the
 *   session route when the tab becomes visible again.
 *
 * Either way `onChange` runs, so a page never keeps showing one user's data while its
 * requests act as another.
 */
export function useSessionKeeper(options: SessionKeeperOptions): void {
  const {
    userId,
    endpoint = defaultSessionEndpoint,
    identityKey = defaultIdentityKey,
    recheckInterval = 60_000,
  } = options;
  const onChange = useRef(options.onChange ?? reload);
  useEffect(() => {
    onChange.current = options.onChange ?? reload;
  });

  useEffect(() => {
    let done = false;
    let lastCheck = Date.now();
    const changed = (next: string | null) => {
      if (done || next === userId) return;
      done = true;
      onChange.current(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === identityKey) changed(event.newValue);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < recheckInterval)
        return;
      lastCheck = Date.now();
      fetch(endpoint, { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { user: { id: string } | null };
          changed(body.user?.id ?? null);
        })
        .catch(() => {
          // Offline: check again on the next visit.
        });
    };
    globalThis.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      globalThis.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, endpoint, identityKey, recheckInterval]);
}

/** {@link useSessionKeeper} as a component. Render it once in a layout; it renders nothing. */
export function SessionKeeper(props: Readonly<Omit<SessionKeeperOptions, "onChange">>): null {
  useSessionKeeper(props);
  return null;
}

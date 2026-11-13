"use client";

import { Button } from "@quickben/admin/ui";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { idleState } from "./state";

import type { FormState } from "./state";

/** Delete with an inline confirmation step. Shows the server's refusal (e.g. "in use"). */
export function DeleteButton({
  action,
  label,
  title,
}: Readonly<{
  action: (previous: FormState) => Promise<FormState>;
  label: string;
  title: string;
}>) {
  const [confirming, setConfirming] = useState(false);
  const [state, runDelete, pending] = useActionState(action, idleState);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  if (!confirming) {
    return (
      <Button
        variant="secondary"
        className="qb:w-full qb:text-red-700"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Delete {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Delete ${label}`} className="qb:space-y-3">
      <p className="qb:text-sm qb:text-zinc-700">Delete “{title}”? This cannot be undone.</p>
      {state.status === "error" ? (
        <p role="alert" className="qb:text-sm qb:text-red-600">
          {state.message}
        </p>
      ) : null}
      <div className="qb:flex qb:gap-2">
        <Button
          ref={confirmRef}
          variant="danger"
          disabled={pending}
          onClick={() => {
            startTransition(() => {
              runDelete();
            });
          }}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

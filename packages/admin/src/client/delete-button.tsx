"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { idleState } from "../form-state";
import { Button } from "../ui/button";

import type { FormState } from "../form-state";
import type { AdminServerFunction } from "../types";

/** Props of {@link DeleteButton}. */
export interface DeleteButtonProps {
  /** Server function that deletes the document. */
  serverFunction: AdminServerFunction;
  basePath: string;
  slug: string;
  id: string;
  /** Singular collection label, e.g. `Post`. */
  label: string;
  /** Document title, shown in the confirmation. */
  title: string;
}

/** Delete button with an inline confirmation step. */
export function DeleteButton({
  serverFunction,
  basePath,
  slug,
  id,
  label,
  title,
}: Readonly<DeleteButtonProps>) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, runDelete, pending] = useActionState(async (): Promise<FormState> => {
    const result = await serverFunction({ type: "delete", slug, id });
    if (result.status === "ok") {
      router.push(`${basePath}/${slug}?toast=deleted`);
      return idleState;
    }
    return result.status === "error" ? result : idleState;
  }, idleState);
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
        Delete {label.toLowerCase()}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Delete ${label.toLowerCase()}`} className="qb:space-y-3">
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

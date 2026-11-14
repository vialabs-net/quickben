"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { idleState } from "../form-state";
import { useAdminI18n } from "../i18n/context";
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
  const i18n = useAdminI18n();
  const singular = i18n.lower(label);
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
        className="qb:w-full qb:text-danger-strong"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {i18n.t("delete.open", { singular })}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={i18n.t("delete.open", { singular })} className="qb:space-y-3">
      <p className="qb:text-sm qb:text-fg">{i18n.t("delete.confirm", { title })}</p>
      {state.status === "error" ? (
        <p role="alert" className="qb:text-sm qb:text-danger">
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
          {pending ? i18n.t("delete.pending") : i18n.t("delete.submit")}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
          }}
        >
          {i18n.t("delete.cancel")}
        </Button>
      </div>
    </div>
  );
}

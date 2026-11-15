"use client";

import { useAdminI18n } from "@quickben/admin/i18n";
import { Button } from "@quickben/admin/ui";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { connectionsMessages } from "./messages";
import { formMessage, idleState } from "./state";

import type { FormState } from "./state";

/** Delete with an inline confirmation step. Shows the server's refusal (e.g. "in use"). */
export function DeleteButton({
  action,
  kind,
  title,
}: Readonly<{
  action: (previous: FormState) => Promise<FormState>;
  kind: "connection" | "credential";
  title: string;
}>) {
  const { t } = useAdminI18n().scope(connectionsMessages);
  const [confirming, setConfirming] = useState(false);
  const [state, runDelete, pending] = useActionState(action, idleState);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const label = t(kind === "connection" ? "delete.connection" : "delete.credential");
  if (!confirming) {
    return (
      <Button
        variant="secondary"
        className="qb:w-full qb:text-danger-strong"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={label} className="qb:space-y-3">
      <p className="qb:text-sm qb:text-fg">{t("delete.confirm", { title })}</p>
      {state.status === "error" ? (
        <p role="alert" className="qb:text-sm qb:text-danger">
          {formMessage(t, state.message)}
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
          {pending ? t("delete.pending") : t("delete.submit")}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
          }}
        >
          {t("delete.cancel")}
        </Button>
      </div>
    </div>
  );
}

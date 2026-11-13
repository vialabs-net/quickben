"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import { idleState } from "../form-state";
import { controlId, formScope } from "../ids";
import { Button } from "../ui/button";

import type { FormState } from "../form-state";
import type { AdminServerFunction } from "../types";
import type { SubmitEvent, ReactNode } from "react";

const FormStateContext = createContext<FormState>(idleState);
const FormScopeContext = createContext<string>("");

/** Props of {@link DocumentForm}. */
export interface DocumentFormProps {
  /** Server function that saves the document. */
  serverFunction: AdminServerFunction;
  basePath: string;
  slug: string;
  /** Document id, or `null` to create one. */
  id: string | null;
  submitLabel: string;
  /** Hide the submit button. */
  readOnly?: boolean;
  /** Extra controls next to the submit button, such as a cancel link. */
  secondary?: ReactNode;
  children: ReactNode;
}

/**
 * Form for creating or editing a document. It submits without a full page reload, keeps the
 * values on errors, marks invalid fields with `aria-invalid` and focuses the first one.
 */
export function DocumentForm({
  serverFunction,
  basePath,
  slug,
  id,
  submitLabel,
  readOnly,
  secondary,
  children,
}: Readonly<DocumentFormProps>) {
  const router = useRouter();
  const scope = formScope(slug, id);
  const [state, formAction, pending] = useActionState(
    async (_previous: FormState, formData: FormData): Promise<FormState> => {
      const result = await serverFunction({ type: "save", slug, id, formData });
      if (result.status === "ok") {
        const toast = id === null ? "created" : "saved";
        router.push(`${basePath}/${slug}/${encodeURIComponent(result.id)}?toast=${toast}`);
        return idleState;
      }
      if (result.status === "error") return result;
      return idleState;
    },
    idleState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // The form only works with JavaScript. Keep submit disabled until it is hydrated, so an
  // early click cannot fall back to a native submit.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const element of form.querySelectorAll("[aria-invalid]")) {
      element.removeAttribute("aria-invalid");
    }
    if (state.status !== "error") return;
    let firstInvalid: HTMLElement | null = null;
    for (const name of Object.keys(state.fieldErrors)) {
      const element = form.querySelector<HTMLElement>(`#${controlId(scope, name)}`);
      if (!element) continue;
      element.setAttribute("aria-invalid", "true");
      firstInvalid ??= element;
    }
    firstInvalid?.focus();
  }, [state, scope]);

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    // Submit through a transition instead of `<form action>`: React resets uncontrolled
    // inputs after a form action, which would drop the user's input on validation errors.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  };

  return (
    <FormStateContext value={state}>
      <FormScopeContext value={scope}>
        <form ref={formRef} method="post" onSubmit={onSubmit} aria-busy={pending}>
          {state.status === "error" ? (
            <div
              role="alert"
              className="qb:mx-5 qb:mt-5 qb:rounded-md qb:border qb:border-red-200 qb:bg-red-50 qb:px-4 qb:py-3 qb:text-sm qb:text-red-800"
            >
              {state.message}
            </div>
          ) : null}
          <div className="qb:p-5">{children}</div>
          {readOnly ? null : (
            <div className="qb:flex qb:items-center qb:gap-3 qb:border-t qb:border-zinc-200 qb:bg-zinc-50 qb:px-5 qb:py-3 qb:rounded-b-lg">
              <Button type="submit" variant="primary" disabled={pending || !ready}>
                {pending ? "Saving…" : submitLabel}
              </Button>
              {secondary}
            </div>
          )}
        </form>
      </FormScopeContext>
    </FormStateContext>
  );
}

/** Error message of one field, from the last submit. */
export function FieldError({ name }: Readonly<{ name: string }>) {
  const state = use(FormStateContext);
  const scope = use(FormScopeContext);
  const message = state.status === "error" ? state.fieldErrors[name] : undefined;
  if (!message) return null;
  return (
    <p id={`${controlId(scope, name)}-error`} className="qb:text-xs qb:font-medium qb:text-red-600">
      {message}
    </p>
  );
}

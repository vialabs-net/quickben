"use client";

import { Button, FieldHint, Label } from "@quickben/admin/ui";
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import { idleState } from "./state";

import type { FormState } from "./state";
import type { ReactNode, SubmitEvent } from "react";

const FormStateContext = createContext<FormState>(idleState);

/** Id of the control for a field name, inside one form. */
export function controlId(scope: string, name: string): string {
  return `${scope}-${name.replaceAll(/[^\w-]/g, "-")}`;
}

/** Props of {@link ActionForm}. */
export interface ActionFormProps {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Prefix of control ids, unique on the page. */
  scope: string;
  submitLabel: string;
  readOnly?: boolean;
  secondary?: ReactNode;
  children: ReactNode;
}

/**
 * A form that runs a server action without a page reload, keeps the values on errors, marks
 * invalid fields and focuses the first one. Same behavior as the admin's document form.
 */
export function ActionForm({
  action,
  scope,
  submitLabel,
  readOnly,
  secondary,
  children,
}: Readonly<ActionFormProps>) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const formRef = useRef<HTMLFormElement>(null);
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
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  };
  return (
    <FormStateContext value={state}>
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
            <Button type="submit" disabled={pending || !ready}>
              {pending ? "Saving…" : submitLabel}
            </Button>
            {secondary}
          </div>
        )}
      </form>
    </FormStateContext>
  );
}

/** Props of {@link FormField}. */
export interface FormFieldProps {
  scope: string;
  /** Form control name; errors are looked up by it. */
  name: string;
  label: string;
  required?: boolean;
  hint?: string | null;
  /** Grid span in the 6-column form grid. Default half width. */
  span?: "half" | "full";
  /** Renders the control with its id and `aria-describedby`. */
  children: (control: { id: string; describedBy: string }) => ReactNode;
}

/** A label, a control, its hint and its error. */
export function FormField({
  scope,
  name,
  label,
  required,
  hint,
  span = "half",
  children,
}: Readonly<FormFieldProps>) {
  const state = use(FormStateContext);
  const id = controlId(scope, name);
  const error = state.status === "error" ? state.fieldErrors[name] : undefined;
  return (
    <div
      className={
        span === "full" ? "qb:space-y-1.5 qb:md:col-span-6" : "qb:space-y-1.5 qb:md:col-span-3"
      }
    >
      <Label htmlFor={id}>
        {label}
        {required ? <span className="qb:text-red-600"> *</span> : null}
      </Label>
      {children({ id, describedBy: `${id}-hint ${id}-error` })}
      {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
      {error ? (
        <p id={`${id}-error`} className="qb:text-xs qb:text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

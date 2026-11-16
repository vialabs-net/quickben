import { cn, focusRing } from "./cn";

import type { ComponentProps, ReactNode } from "react";

const control = cn(
  "qb:block qb:w-full qb:rounded-md qb:border qb:border-line-strong qb:bg-surface qb:px-3 qb:py-2 qb:text-sm qb:text-fg qb:shadow-xs",
  "qb:placeholder:text-fg-subtle qb:disabled:cursor-not-allowed qb:disabled:bg-surface-muted qb:disabled:text-fg-muted",
  "qb:aria-invalid:border-danger",
  focusRing,
);

/** Text-like input. */
export function Input({ className, ...props }: Readonly<ComponentProps<"input">>) {
  return <input className={cn(control, "qb:h-9", className)} {...props} />;
}

/** Multi-line text input. */
export function Textarea({ className, ...props }: Readonly<ComponentProps<"textarea">>) {
  return <textarea className={cn(control, "qb:min-h-24", className)} {...props} />;
}

/**
 * Native select. It fits its column: a long selected label is cut with an ellipsis, and the
 * open list shows the options in full.
 */
export function Select({ className, ...props }: Readonly<ComponentProps<"select">>) {
  return (
    <select
      className={cn(control, "qb:h-9 qb:max-w-full qb:min-w-0 qb:truncate qb:pr-8", className)}
      {...props}
    />
  );
}

/** Checkbox. Pair it with a `<label>`. */
export function Checkbox({ className, ...props }: Readonly<ComponentProps<"input">>) {
  return (
    <input
      type="checkbox"
      className={cn("qb:size-4 qb:rounded qb:accent-accent", focusRing, className)}
      {...props}
    />
  );
}

/** Props of {@link Label}. `htmlFor` is required: every label names the control it describes. */
export type LabelProps = Omit<ComponentProps<"label">, "htmlFor" | "children"> & {
  htmlFor: string;
  children: ReactNode;
};

/** Field label for the control with the id `htmlFor`. */
export function Label({ htmlFor, className, children, ...props }: Readonly<LabelProps>) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("qb:text-sm qb:font-medium qb:text-fg", className)}
      {...props}
    >
      {children}
    </label>
  );
}

/** Help text under a field. */
export function FieldHint({ id, children }: Readonly<{ id?: string; children: ReactNode }>) {
  return (
    <p id={id} className="qb:text-xs qb:text-fg-muted">
      {children}
    </p>
  );
}

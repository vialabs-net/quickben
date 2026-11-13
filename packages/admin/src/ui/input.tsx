import { cn, focusRing } from "./cn";

import type { ComponentProps, ReactNode } from "react";

const control = cn(
  "qb:block qb:w-full qb:rounded-md qb:border qb:border-zinc-300 qb:bg-white qb:px-3 qb:py-2 qb:text-sm qb:text-zinc-900 qb:shadow-xs",
  "qb:placeholder:text-zinc-400 qb:disabled:cursor-not-allowed qb:disabled:bg-zinc-50 qb:disabled:text-zinc-500",
  "qb:aria-invalid:border-red-500",
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

/** Native select. */
export function Select({ className, ...props }: Readonly<ComponentProps<"select">>) {
  return <select className={cn(control, "qb:h-9 qb:pr-8", className)} {...props} />;
}

/** Checkbox. Pair it with a `<label>`. */
export function Checkbox({ className, ...props }: Readonly<ComponentProps<"input">>) {
  return (
    <input
      type="checkbox"
      className={cn("qb:size-4 qb:rounded qb:accent-zinc-900", focusRing, className)}
      {...props}
    />
  );
}

/** Field label. */
export function Label({ className, ...props }: Readonly<ComponentProps<"label">>) {
  return (
    <label className={cn("qb:text-sm qb:font-medium qb:text-zinc-900", className)} {...props} />
  );
}

/** Help text under a field. */
export function FieldHint({ id, children }: Readonly<{ id?: string; children: ReactNode }>) {
  return (
    <p id={id} className="qb:text-xs qb:text-zinc-500">
      {children}
    </p>
  );
}

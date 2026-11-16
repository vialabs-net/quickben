import Link from "next/link";

import { cn, focusRing } from "./cn";

import type { AnchorHTMLAttributes, ComponentProps } from "react";

/** Visual style of a button. */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** Size of a button. */
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "qb:bg-accent qb:text-accent-fg qb:hover:bg-accent-hover qb:shadow-xs",
  secondary:
    "qb:border qb:border-line-strong qb:bg-surface qb:text-fg qb:hover:bg-surface-muted qb:shadow-xs",
  danger: "qb:bg-danger qb:text-danger-fg qb:hover:bg-danger-hover qb:shadow-xs",
  ghost: "qb:text-fg qb:hover:bg-surface-strong qb:hover:text-fg",
};

const sizes: Record<ButtonSize, string> = {
  sm: "qb:h-8 qb:px-3 qb:text-sm",
  md: "qb:h-9 qb:px-4 qb:text-sm",
};

/** Class names of a button, for elements that should look like one. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return cn(
    "qb:inline-flex qb:shrink-0 qb:items-center qb:justify-center qb:gap-2 qb:rounded-(--qb-button-radius) qb:font-medium qb:whitespace-nowrap qb:transition-colors qb:disabled:pointer-events-none qb:disabled:opacity-50",
    focusRing,
    variants[variant],
    sizes[size],
  );
}

/** Props of {@link Button}. */
export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A button. `type` defaults to `button`, so it never submits a form by accident. */
export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: Readonly<ButtonProps>) {
  return <button type={type} className={cn(buttonClass(variant, size), className)} {...props} />;
}

/** Props of {@link ButtonLink}. */
export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A link that looks like a button. Uses client-side navigation. */
export function ButtonLink({
  variant,
  size,
  className,
  href,
  ...props
}: Readonly<ButtonLinkProps>) {
  return <Link href={href} className={cn(buttonClass(variant, size), className)} {...props} />;
}

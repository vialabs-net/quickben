import Link from "next/link";

import { cn, focusRing } from "./cn";

import type { AnchorHTMLAttributes, ComponentProps } from "react";

/** Visual style of a button. */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** Size of a button. */
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "qb:bg-zinc-900 qb:text-white qb:hover:bg-zinc-700 qb:shadow-xs",
  secondary:
    "qb:border qb:border-zinc-300 qb:bg-white qb:text-zinc-900 qb:hover:bg-zinc-50 qb:shadow-xs",
  danger: "qb:bg-red-600 qb:text-white qb:hover:bg-red-500 qb:shadow-xs",
  ghost: "qb:text-zinc-700 qb:hover:bg-zinc-100 qb:hover:text-zinc-900",
};

const sizes: Record<ButtonSize, string> = {
  sm: "qb:h-8 qb:px-3 qb:text-sm",
  md: "qb:h-9 qb:px-4 qb:text-sm",
};

/** Class names of a button, for elements that should look like one. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return cn(
    "qb:inline-flex qb:shrink-0 qb:items-center qb:justify-center qb:gap-2 qb:rounded-md qb:font-medium qb:whitespace-nowrap qb:transition-colors qb:disabled:pointer-events-none qb:disabled:opacity-50",
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

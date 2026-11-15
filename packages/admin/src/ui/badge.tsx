import { cn } from "./cn";

import type { HTMLAttributes } from "react";

/** Color of a badge. */
export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

const tones: Record<BadgeTone, string> = {
  neutral: "qb:bg-surface-strong qb:text-fg qb:ring-line",
  green: "qb:bg-success-soft qb:text-success qb:ring-success-line",
  amber: "qb:bg-warning-soft qb:text-warning qb:ring-warning-line",
  red: "qb:bg-danger-soft qb:text-danger-strong qb:ring-danger-line",
  blue: "qb:bg-info-soft qb:text-info qb:ring-info-line",
};

/** Props of {@link Badge}. */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** A small label for statuses and values. */
export function Badge({ tone = "neutral", className, ...props }: Readonly<BadgeProps>) {
  return (
    <span
      className={cn(
        "qb:inline-flex qb:items-center qb:rounded-md qb:px-1.5 qb:py-0.5 qb:text-xs qb:font-medium qb:ring-1 qb:ring-inset qb:whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

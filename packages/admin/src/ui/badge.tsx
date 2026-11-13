import { cn } from "./cn";

import type { HTMLAttributes } from "react";

/** Color of a badge. */
export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

const tones: Record<BadgeTone, string> = {
  neutral: "qb:bg-zinc-100 qb:text-zinc-700 qb:ring-zinc-200",
  green: "qb:bg-emerald-50 qb:text-emerald-700 qb:ring-emerald-200",
  amber: "qb:bg-amber-50 qb:text-amber-800 qb:ring-amber-200",
  red: "qb:bg-red-50 qb:text-red-700 qb:ring-red-200",
  blue: "qb:bg-blue-50 qb:text-blue-700 qb:ring-blue-200",
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

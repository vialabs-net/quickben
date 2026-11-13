import { cn } from "./cn";

import type { HTMLAttributes, ReactNode } from "react";

/** A bordered panel. */
export function Card({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn(
        "qb:rounded-lg qb:border qb:border-zinc-200 qb:bg-white qb:shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

/** Title row of a card, with optional actions on the right. */
export function CardHeader({
  title,
  description,
  actions,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <div className="qb:flex qb:items-start qb:justify-between qb:gap-4 qb:border-b qb:border-zinc-200 qb:px-5 qb:py-4">
      <div className="qb:min-w-0">
        <h2 className="qb:text-sm qb:font-semibold qb:text-zinc-900">{title}</h2>
        {description ? <p className="qb:mt-1 qb:text-sm qb:text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="qb:flex qb:shrink-0 qb:gap-2">{actions}</div> : null}
    </div>
  );
}

/** Padded body of a card. */
export function CardBody({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("qb:p-5", className)} {...props} />;
}

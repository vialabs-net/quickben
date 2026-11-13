import { cn } from "./cn";

import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/** A data table that scrolls horizontally when it is wider than its container. */
export function Table({ className, ...props }: Readonly<HTMLAttributes<HTMLTableElement>>) {
  return (
    <div className="qb:w-full qb:overflow-x-auto">
      <table className={cn("qb:w-full qb:border-collapse qb:text-sm", className)} {...props} />
    </div>
  );
}

/** Header cell. */
export function Th({ className, ...props }: Readonly<ThHTMLAttributes<HTMLTableCellElement>>) {
  return (
    <th
      className={cn(
        "qb:border-b qb:border-zinc-200 qb:bg-zinc-50 qb:px-4 qb:py-2.5 qb:text-left qb:text-xs qb:font-medium qb:tracking-wide qb:text-zinc-500 qb:uppercase qb:whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

/** Body cell. */
export function Td({ className, ...props }: Readonly<TdHTMLAttributes<HTMLTableCellElement>>) {
  return (
    <td
      className={cn(
        "qb:border-b qb:border-zinc-100 qb:px-4 qb:py-2.5 qb:align-middle qb:text-zinc-700",
        className,
      )}
      {...props}
    />
  );
}

/** Body row with a hover state. */
export function Tr({ className, ...props }: Readonly<HTMLAttributes<HTMLTableRowElement>>) {
  return <tr className={cn("qb:hover:bg-zinc-50", className)} {...props} />;
}

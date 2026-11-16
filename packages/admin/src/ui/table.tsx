import { cn } from "./cn";

import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * A data table that scrolls horizontally inside its own box when it is wider than its
 * container, with shadows at the edges that can scroll. It never widens the page. Rows are
 * at least `--qb-table-row-height` high.
 */
export function Table({ className, ...props }: Readonly<HTMLAttributes<HTMLTableElement>>) {
  return (
    <div className="qb-table-scroll qb:w-full">
      <table className={cn("qb:w-full qb:border-collapse qb:text-sm", className)} {...props} />
    </div>
  );
}

/** Header cell. */
export function Th({ className, ...props }: Readonly<ThHTMLAttributes<HTMLTableCellElement>>) {
  return (
    <th
      className={cn(
        "qb:border-b qb:border-line qb:bg-surface-muted qb:px-4 qb:py-2.5 qb:text-left qb:text-xs qb:font-medium qb:tracking-wide qb:text-fg-muted qb:uppercase qb:whitespace-nowrap",
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
        "qb:border-b qb:border-line-soft qb:px-4 qb:py-2.5 qb:align-middle qb:text-fg",
        className,
      )}
      {...props}
    />
  );
}

/** Body row with a hover state. */
export function Tr({ className, ...props }: Readonly<HTMLAttributes<HTMLTableRowElement>>) {
  return <tr className={cn("qb:hover:bg-surface-muted", className)} {...props} />;
}

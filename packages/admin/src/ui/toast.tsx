"use client";

import { useEffect, useState } from "react";

import { cn, focusRing } from "./cn";

/** Props of {@link Toast}. */
export interface ToastProps {
  message: string;
  tone?: "success" | "error";
  /** Milliseconds before it hides. Default 4000. */
  duration?: number;
  /** Search parameter to remove from the URL once shown, so a reload does not repeat it. */
  param?: string;
}

/** A short notice in the corner of the screen. Announced to screen readers. */
export function Toast({ message, tone = "success", duration = 4000, param }: Readonly<ToastProps>) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (param) {
      const url = new URL(globalThis.location.href);
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        globalThis.history.replaceState(globalThis.history.state, "", url);
      }
    }
    const timer = setTimeout(() => {
      setOpen(false);
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, param]);

  if (!open) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "qb:fixed qb:right-4 qb:bottom-4 qb:z-50 qb:flex qb:max-w-sm qb:items-center qb:gap-3 qb:rounded-lg qb:px-4 qb:py-3 qb:text-sm qb:shadow-lg",
        tone === "error" ? "qb:bg-red-600 qb:text-white" : "qb:bg-zinc-900 qb:text-white",
      )}
    >
      <span>{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        className={cn("qb:rounded qb:px-1 qb:text-white/70 qb:hover:text-white", focusRing)}
        onClick={() => {
          setOpen(false);
        }}
      >
        ×
      </button>
    </div>
  );
}

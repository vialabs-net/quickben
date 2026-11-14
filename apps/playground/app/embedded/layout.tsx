import "@quickben/admin/styles.css";
import "./embedded.css";

import { Suspense } from "react";

import { HostNav } from "./host-nav";

import type { ReactNode } from "react";

export const metadata = { title: "Host app", robots: { index: false, follow: false } };

/**
 * A host app layout around admin pages rendered with `chrome: "none"`: its own header and
 * navigation, and its design tokens mapped onto the admin theme in embedded.css.
 */
export default function EmbeddedLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="host">
      <header className="host-header">
        <span className="host-brand">Host app</span>
        <Suspense fallback={<nav aria-label="Host" className="host-nav" />}>
          <HostNav />
        </Suspense>
      </header>
      <main className="host-main">{children}</main>
    </div>
  );
}

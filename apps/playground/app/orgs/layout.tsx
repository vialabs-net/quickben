import "@quickben/admin/styles.css";

import type { ReactNode } from "react";

export const metadata = { title: "Organization", robots: { index: false, follow: false } };

export default function OrganizationLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}

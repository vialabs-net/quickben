import "@quickben/admin/styles.css";

import type { ReactNode } from "react";

export const metadata = { title: "Admin · {{name}}" };

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}

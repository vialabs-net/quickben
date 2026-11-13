import "@quickben/admin/styles.css";

import { generateAdminMetadata } from "@quickben/admin";

import config from "@/quickben.config";

import type { ReactNode } from "react";

export const metadata = generateAdminMetadata(config);

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}

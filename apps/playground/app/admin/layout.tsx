import "@quickben/admin/styles.css";
import "@quickben/plugin-templates/styles.css";

import { generateAdminMetadata } from "@quickben/admin";
import { Suspense } from "react";

import config from "@/quickben.config";

import { RoleBar, RoleBarFallback } from "../role-bar";

import type { ReactNode } from "react";

export const metadata = generateAdminMetadata(config);

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <Suspense fallback={<RoleBarFallback />}>
        <RoleBar />
      </Suspense>
      {children}
    </>
  );
}

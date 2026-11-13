import "@quickben/admin/styles.css";

import { RoleBar } from "../role-bar";

import type { ReactNode } from "react";

export const metadata = { title: "Admin · Quickben Playground" };

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <RoleBar />
      {children}
    </>
  );
}

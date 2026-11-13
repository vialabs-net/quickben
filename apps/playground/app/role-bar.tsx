import { cookies } from "next/headers";
import Link from "next/link";

import { defaultRole, isDemoRole, roleCookie } from "@/lib/auth";

import { RoleSwitcher } from "./role-switcher";

/** Demo bar: links and the role switcher. */
export async function RoleBar() {
  const value = (await cookies()).get(roleCookie)?.value;
  const role = isDemoRole(value) ? value : defaultRole;
  return (
    <div className="role-bar">
      <span className="role-bar-title">Quickben Playground</span>
      <nav aria-label="Playground">
        <Link href="/">Public page</Link>
        <Link href="/admin">Admin</Link>
        <a href="/api/_meta">API</a>
      </nav>
      <RoleSwitcher key={role} role={role} />
    </div>
  );
}

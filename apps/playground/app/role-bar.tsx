import { cookies } from "next/headers";
import Link from "next/link";

import { defaultRole, isDemoRole, roleCookie } from "@/lib/auth";

import { RoleSwitcher } from "./role-switcher";

function Links() {
  return (
    <>
      <span className="role-bar-title">Quickben Playground</span>
      <nav aria-label="Playground">
        <Link href="/">Public page</Link>
        <Link href="/admin">Admin</Link>
        <a href="/api/_meta">API</a>
      </nav>
    </>
  );
}

/** Demo bar: links and the role switcher. It reads a cookie, so render it in `<Suspense>`. */
export async function RoleBar() {
  const value = (await cookies()).get(roleCookie)?.value;
  const role = isDemoRole(value) ? value : defaultRole;
  return (
    <div className="role-bar">
      <Links />
      <RoleSwitcher key={role} role={role} />
    </div>
  );
}

/** The demo bar without the role switcher, shown while {@link RoleBar} loads. */
export function RoleBarFallback() {
  return (
    <div className="role-bar">
      <Links />
    </div>
  );
}

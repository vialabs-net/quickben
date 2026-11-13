import { cookies, headers } from "next/headers";
import Link from "next/link";

import { defaultRole, isDemoRole, roleCookie } from "@/lib/auth";
import { betterAuthEnabled, getAuth } from "@/lib/better-auth";

import { RoleSwitcher } from "./role-switcher";
import { SignOutButton } from "./sign-out-button";

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
  if (betterAuthEnabled) return <AccountBar />;
  const value = (await cookies()).get(roleCookie)?.value;
  const role = isDemoRole(value) ? value : defaultRole;
  return (
    <div className="role-bar">
      <Links />
      <RoleSwitcher key={role} role={role} />
    </div>
  );
}

/** With QUICKBEN_AUTH=better-auth: the signed-in email and a sign-out button. */
async function AccountBar() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="role-bar">
      <Links />
      {session ? (
        <span className="role-switcher">
          {session.user.email} <SignOutButton />
        </span>
      ) : (
        <Link href="/sign-in">Sign in</Link>
      )}
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

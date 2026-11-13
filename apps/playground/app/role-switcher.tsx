"use client";

import { setRole } from "./actions";

import type { DemoRole } from "@/lib/auth";

const roles: { value: DemoRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
  { value: "anonymous", label: "Anonymous" },
];

/** Pick the demo user. Submits as soon as the choice changes. */
export function RoleSwitcher({ role }: Readonly<{ role: DemoRole }>) {
  return (
    <form action={setRole} className="role-switcher">
      <label htmlFor="demo-role">Acting as</label>
      <select
        id="demo-role"
        name="role"
        defaultValue={role}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {roles.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Switch</button>
      </noscript>
    </form>
  );
}

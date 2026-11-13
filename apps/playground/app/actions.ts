"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { isDemoRole, roleCookie } from "@/lib/auth";

/** Store the demo role chosen in the role switcher. */
export async function setRole(formData: FormData): Promise<void> {
  const role = formData.get("role");
  if (typeof role !== "string" || !isDemoRole(role)) return;
  const store = await cookies();
  store.set(roleCookie, role, { path: "/", sameSite: "lax", httpOnly: true });
  // Re-render every page with the new user.
  revalidatePath("/", "layout");
}

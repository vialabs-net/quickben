"use server";

import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import { resolveTenant } from "@quickben/plugin-tenancy";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import config from "@/quickben.config";

/** Server action of the custom "Contact" settings section. */
export async function saveContact(formData: FormData): Promise<void> {
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const tenant = await resolveTenant(qb, ctx);
  const email = formData.get("contactEmail");
  const back = formData.get("back");
  await qb.update(
    "organizations",
    tenant.organizationId ?? "",
    { contactEmail: typeof email === "string" && email !== "" ? email : null },
    ctx,
  );
  // Only paths of this app.
  const target = typeof back === "string" && /^\/[a-z]/.test(back) ? back : "/admin/organization";
  revalidatePath(target);
  redirect(`${target}?saved=1`);
}

import "@quickben/admin/styles.css";

import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { betterAuthEnabled, demoPassword } from "@/lib/better-auth";

import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in · Quickben Playground" };

async function SignIn() {
  // Decide at request time: the build does not know QUICKBEN_AUTH of `next start`.
  await connection();
  if (!betterAuthEnabled) notFound();
  return <SignInForm demoPassword={demoPassword} />;
}

/** Email and password sign-in, with QUICKBEN_AUTH=better-auth. */
export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

"use client";

import { Button, Card, CardBody, Input, Label } from "@quickben/admin/ui";
import { useState } from "react";

import type { SubmitEvent } from "react";

/** Sign in or sign up with Better Auth's email and password routes. */
export function SignInForm({ demoPassword }: Readonly<{ demoPassword: string }>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const email = text("email");
    const password = text("password");
    const signUp = (event.nativeEvent.submitter as HTMLButtonElement | null)?.value === "sign-up";
    setBusy(true);
    setError(null);
    const body = signUp ? { email, password, name: email.split("@")[0] } : { email, password };
    const response = await fetch(`/api/auth/${signUp ? "sign-up" : "sign-in"}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      globalThis.location.assign("/admin");
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    setError(data.message ?? "Sign-in failed");
    setBusy(false);
  }

  return (
    <div className="qb-root qb:flex qb:min-h-screen qb:items-center qb:justify-center qb:bg-zinc-50 qb:px-4 qb:py-12">
      <Card className="qb:w-full qb:max-w-sm">
        <CardBody>
          <form className="qb:flex qb:flex-col qb:gap-3" onSubmit={(event) => void submit(event)}>
            <h1 className="qb:text-2xl qb:font-semibold qb:text-zinc-900">Sign in</h1>
            <p className="qb:text-sm qb:text-zinc-500">
              Demo users: admin@example.com, editor@example.com, viewer@example.com. Password:{" "}
              <code>{demoPassword}</code>
            </p>
            {error ? (
              <p
                role="alert"
                className="qb:rounded-md qb:bg-red-50 qb:px-3 qb:py-2 qb:text-sm qb:text-red-700"
              >
                {error}
              </p>
            ) : null}
            <div className="qb:flex qb:flex-col qb:gap-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="qb:flex qb:flex-col qb:gap-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                required
              />
            </div>
            <Button type="submit" value="sign-in" disabled={busy}>
              Sign in
            </Button>
            <Button type="submit" value="sign-up" variant="secondary" disabled={busy}>
              Create account
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

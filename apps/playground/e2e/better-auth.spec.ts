import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Runs only with Better Auth: QUICKBEN_AUTH=better-auth.
test.skip(process.env.QUICKBEN_AUTH !== "better-auth", "needs QUICKBEN_AUTH=better-auth");

const password = "playground-password";

async function signIn(page: Page, email: string, secret = password) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("roles follow the Better Auth user, and sign-out ends the session", async ({ page }) => {
  await signIn(page, "viewer@example.com");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator(".role-bar").getByText("viewer@example.com")).toBeVisible();
  await page.goto("/admin/posts");
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New post" })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/admin/settings");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

  await signIn(page, "editor@example.com");
  await expect(page.locator(".role-bar").getByText("editor@example.com")).toBeVisible();
  await page.goto("/admin/posts");
  await expect(page.getByRole("link", { name: "New post" })).toBeVisible();
});

test("a wrong password shows an error", async ({ page }) => {
  await signIn(page, "admin@example.com", "not-the-password");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a new account signs up as a viewer", async ({ page }) => {
  const email = `new-${String(Date.now())}@example.com`;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-new-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator(".role-bar").getByText(email)).toBeVisible();
  const response = await page.request.post("/api/posts", { data: { title: "Nope" } });
  expect(response.status()).toBe(403);
});

import { expect, test } from "@playwright/test";

// The embedded admin (`chrome: "none"`) inside the host layout of app/embedded. Single-tenant
// playground in English.
test.skip(
  process.env.QUICKBEN_TENANCY === "1" ||
    process.env.QUICKBEN_AUTH === "better-auth" ||
    (process.env.QUICKBEN_LOCALE ?? "en") !== "en",
  "single-tenant playground in English",
);

test("admin pages render inside the host layout", async ({ page }) => {
  await page.goto("/embedded/posts");
  await expect(page.getByText("Host app", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  // No admin shell: no sidebar navigation, no skip link.
  await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(0);

  // The host navigation comes from getAdminNav.
  const nav = page.getByRole("navigation", { name: "Host" });
  await expect(nav.getByRole("link", { name: "Posts" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Authors" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Authors" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Authors" })).toHaveAttribute("aria-current", "page");

  // The host maps its brand color and radius onto the admin tokens.
  const button = page.getByRole("link", { name: "New author" });
  await expect(button).toHaveCSS("background-color", "rgb(67, 56, 202)");
  await expect(button).toHaveCSS("border-top-left-radius", "12px");
});

test("create and delete a document in embedded mode", async ({ page }) => {
  await page.goto("/embedded/tags/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("embedded-tag");
  await page.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByRole("status")).toContainText("Tag created");
  await expect(page).toHaveURL(/\/embedded\/tags\/[^/?]+/);
  await expect(page.getByRole("heading", { level: 1, name: "embedded-tag" })).toBeVisible();
  await page.getByRole("button", { name: "Delete tag" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Tag deleted");
  await expect(page).toHaveURL(/\/embedded\/tags$/);
});

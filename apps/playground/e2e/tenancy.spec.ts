import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Runs only against the multi-tenant playground: QUICKBEN_TENANCY=1.
test.skip(process.env.QUICKBEN_TENANCY !== "1", "needs QUICKBEN_TENANCY=1");

async function actAs(page: Page, role: string) {
  await page.goto("/admin");
  const picker = page.getByLabel("Acting as");
  if ((await picker.inputValue()) !== role) {
    // Wait for the role change itself, so a later wait does not catch this POST.
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      picker.selectOption(role),
    ]);
  }
  await expect(picker).toHaveValue(role);
}

async function switchTo(page: Page, name: RegExp | string) {
  const picker = page.getByRole("combobox", { name: "Active organization" });
  const option = picker.getByRole("option", { name });
  const value = await option.getAttribute("value");
  // The server action sets the cookie and redirects to the dashboard.
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    picker.selectOption(value ?? ""),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(picker).toHaveValue(value ?? "");
}

test("a user with two organizations picks one, then sees only its data", async ({ page }) => {
  await actAs(page, "editor");
  const sidebar = page.getByRole("navigation", { name: "Admin" });
  await expect(sidebar.getByRole("link", { name: "Posts" })).toHaveCount(0);

  await switchTo(page, "Acme (owner)");
  await sidebar.getByRole("link", { name: "Posts" }).click();
  await expect(page.getByRole("link", { name: "Getting started with Quickben" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hello from Globex" })).toHaveCount(0);

  await switchTo(page, "Globex (admin)");
  await page.goto("/admin/posts");
  await expect(page.getByRole("link", { name: "Hello from Globex" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Getting started with Quickben" })).toHaveCount(0);
});

test("owners manage members within the guard rails", async ({ page }) => {
  await actAs(page, "editor");
  await switchTo(page, "Acme (owner)");
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();

  await page.getByLabel("Email or user id").fill("eve@example.com");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation created");
  await expect(page.getByRole("cell", { name: "eve@example.com", exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Role of viewer@example.com" }).selectOption("member");
  await page
    .getByRole("row", { name: /viewer@example.com/ })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.getByRole("status")).toContainText("Member updated");

  await page.getByRole("button", { name: "Remove editor@example.com" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "your own owner" })).toBeVisible();
});

test("platform staff see every organization", async ({ page }) => {
  await actAs(page, "admin");
  await expect(page.getByRole("combobox", { name: "Active organization" })).toHaveValue("");
  await page.goto("/admin/posts");
  await expect(page.getByRole("link", { name: "Hello from Globex" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Getting started with Quickben" })).toBeVisible();
  await page.goto("/admin/organization");
  await expect(page.getByText("Choose an organization in the sidebar.")).toBeVisible();
  await switchTo(page, "Acme");
  await page.goto("/admin/organization");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("active");
});

test("fields added by the host respect field access in the settings page", async ({ page }) => {
  await actAs(page, "admin");
  await switchTo(page, "Acme");
  await page.goto("/admin/organization");
  const plan = page.getByRole("combobox", { name: "Plan" });
  await plan.selectOption("pro");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toContainText("Organization saved");
  await expect(page.getByRole("combobox", { name: "Plan" })).toHaveValue("pro");

  // An owner sees the plan but cannot change it: only platform staff can.
  await actAs(page, "editor");
  await switchTo(page, "Acme (owner)");
  await page.goto("/admin/organization");
  await expect(page.getByRole("combobox", { name: "Plan" })).toHaveValue("pro");
  await expect(page.getByRole("combobox", { name: "Plan" })).toBeDisabled();
});

test("owners edit a member's added fields in the details dialog", async ({ page }) => {
  await actAs(page, "editor");
  await switchTo(page, "Acme (owner)");
  await page.goto("/admin/members");
  await page.getByRole("button", { name: "Details of viewer@example.com" }).click();
  const dialog = page.getByRole("dialog", { name: "Details of viewer@example.com" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Job title" }).fill("Reviewer");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Member updated");
  await page.getByRole("button", { name: "Details of viewer@example.com" }).click();
  await expect(dialog.getByRole("textbox", { name: "Job title" })).toHaveValue("Reviewer");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("a custom settings section with its own server action, full and embedded", async ({
  page,
}) => {
  await actAs(page, "editor");
  await switchTo(page, "Acme (owner)");
  await page.goto("/admin/organization");
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  await tabs.getByRole("link", { name: "Contact" }).click();
  await expect(tabs.getByRole("link", { name: "Contact" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("textbox", { name: "Contact email" }).fill("billing@acme.test");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contact saved" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Contact email" })).toHaveValue(
    "billing@acme.test",
  );

  // The same section inside the host layout (chrome: "none").
  await page.goto("/embedded/organization/contact");
  await expect(page.getByText("Host app", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Contact email" })).toHaveValue(
    "billing@acme.test",
  );
  await page.getByRole("textbox", { name: "Contact email" }).fill("ops@acme.test");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page).toHaveURL(/\/embedded\/organization\/contact\?saved=1/);
  await expect(page.getByRole("textbox", { name: "Contact email" })).toHaveValue("ops@acme.test");
});

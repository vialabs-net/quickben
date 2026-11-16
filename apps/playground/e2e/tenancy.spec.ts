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
  await page.getByRole("button", { name: "Invite", exact: true }).click();
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

/** Organization ids by name, from the switcher of a user who belongs to both. */
async function organizationIds(page: Page): Promise<Record<string, string>> {
  await actAs(page, "editor");
  const options = page.getByRole("combobox", { name: "Active organization" }).getByRole("option");
  const ids: Record<string, string> = {};
  for (const option of await options.all()) {
    const name = (await option.textContent())?.split(" (")[0] ?? "";
    const value = (await option.getAttribute("value")) ?? "";
    if (value !== "") ids[name] = value;
  }
  return ids;
}

test("a host URL selects the organization, checked against memberships", async ({ page }) => {
  // Visits several routes, some compiled for the first time in dev.
  test.slow();
  const ids = await organizationIds(page);
  // The cookie says Globex; the URL says Acme, and wins.
  await switchTo(page, "Globex (admin)");
  await page.goto(`/orgs/${ids.Acme!}/members`);
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(page.getByText(/People in Acme/)).toBeVisible();
  await expect(page.getByRole("row", { name: /viewer@example\.com/ })).toBeVisible();

  await page.goto(`/orgs/${ids.Globex!}/members`);
  await expect(page.getByText(/People in Globex/)).toBeVisible();
  await expect(page.getByRole("row", { name: /viewer@example\.com/ })).toHaveCount(0);

  // The switcher goes to the host URL of the chosen organization.
  const picker = page.getByRole("combobox", { name: "Active organization" });
  await Promise.all([
    page.waitForURL(`**/orgs/${ids.Acme!}/members`),
    picker.selectOption(ids.Acme!),
  ]);
  await expect(page.getByText(/People in Acme/)).toBeVisible();

  // Actions on the page use the organization of the URL.
  const invitee = `url-${String(Date.now())}@example.com`;
  await page.getByLabel("Email or user id").fill(invitee);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Invitation created");
  await expect(page).toHaveURL(new RegExp(`/orgs/${ids.Acme!}/members`));
  await expect(page.getByRole("cell", { name: invitee, exact: true })).toBeVisible();

  // A user who is not a member of the organization in the URL gets no data.
  await actAs(page, "viewer");
  await page.goto(`/orgs/${ids.Globex!}/members`);
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
  await expect(page.getByRole("row", { name: /editor@example\.com/ })).toHaveCount(0);
  await page.goto("/orgs/invented-organization/members");
  await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
});

test("a member hook stops an invitation with the host's message", async ({ page }) => {
  await actAs(page, "editor");
  await switchTo(page, "Acme (owner)");
  await page.goto("/admin/members");
  await page.getByLabel("Email or user id").fill("someone@blocked.example");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This host does not invite people from blocked.example." }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "someone@blocked.example", exact: true }),
  ).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// The templates plugin is on in every e2e run (see playwright.config.ts): this runs with and
// without tenancy.
test.skip(process.env.QUICKBEN_TEMPLATES === "0", "needs QUICKBEN_TEMPLATES=1");

const tenancy = process.env.QUICKBEN_TENANCY === "1";

/** As the default `admin` user. With tenancy, it is platform staff and works inside Acme. */
async function openAdmin(page: Page) {
  await page.goto("/admin");
  await expect(page.getByLabel("Acting as")).toHaveValue("admin");
  if (!tenancy) return;
  const picker = page.getByRole("combobox", { name: "Active organization" });
  const value = await picker.getByRole("option", { name: "Acme" }).getAttribute("value");
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    picker.selectOption(value ?? ""),
  ]);
  await expect(picker).toHaveValue(value ?? "");
}

test("create a draft, insert a variable, preview and publish", async ({ page }) => {
  await openAdmin(page);
  await page.goto("/admin/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Document templates" })).toBeVisible();
  await page.getByRole("link", { name: "Edit Invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoice", exact: true })).toBeVisible();

  const editor = page.getByRole("textbox", { name: "Template text" });
  await expect(editor).toBeVisible();
  const preview = page.frameLocator('iframe[title="Document preview"]');
  await expect(preview.getByText("Billed to Ada Lovelace")).toBeVisible();

  // Type at the end of the "Total" line, then insert a variable from the panel.
  await editor.getByText("Total:").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" for ");
  await page.getByRole("button", { name: "Insert Customer email" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(preview.getByText("for ada@example.com")).toBeVisible();

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toContainText(/Draft v\d+ saved/);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Publish this version?");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toContainText(/Version \d+ published/);
  await expect(page.getByText(/Published · v\d+/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "History" })).toContainText("published");
});

test("publishing refuses content with problems and points at them", async ({ page }) => {
  await openAdmin(page);
  await page.goto("/admin/templates/invoice");
  const editor = page.getByRole("textbox", { name: "Template text" });
  await editor.getByText("Billed to").click();
  await page.getByRole("button", { name: "Conditional block" }).click();
  const condition = page.getByPlaceholder("order.paid and total > 100").first();
  await expect(condition).toHaveValue("");
  await condition.pressSequentially("invoice.missing");
  await expect(condition).toHaveValue("invoice.missing");

  const problems = page.getByRole("region", { name: "Problems" });
  await expect(problems).toContainText('Unknown variable "invoice.missing"');

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Not published: fix the marked problems first.")).toBeVisible();
  // A refused publish saves nothing.
  await expect(page.getByText(/Draft · v\d+/)).toHaveCount(0);
});

test("the brand shows in the letterhead preview", async ({ page }) => {
  await openAdmin(page);
  await page.goto("/admin/brand");
  await page.getByLabel("Display name").fill("Acme Documents");
  await page.getByLabel("Legal name").fill("Acme Inc.");
  await page.getByRole("button", { name: "Save brand" }).click();
  await expect(page.getByRole("status")).toContainText("Brand saved");
  const preview = page.frameLocator('iframe[title="Brand preview"]');
  await expect(preview.getByText("Acme Inc.")).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("Acme Documents");
});

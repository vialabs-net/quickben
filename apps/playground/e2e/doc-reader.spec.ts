import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Runs only with the doc reader on: QUICKBEN_DOC_READER=1. The model is a fake; no network.
test.skip(process.env.QUICKBEN_DOC_READER !== "1", "needs QUICKBEN_DOC_READER=1");

// A 2x2 PNG: the fake model reads any image.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mP8z8DwnwEJMAIAHvICAZPAc4UAAAAASUVORK5CYII=",
  "base64",
);

const unique = () => `receipt-${String(Date.now())}`;

async function submit(page: Page, name: string) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name, exact: true }).click(),
  ]);
}

test("staff create a type, test it on a sample, compare models and publish it", async ({
  page,
}) => {
  const key = unique();
  await page.goto("/admin/document-types");
  await expect(page.getByRole("heading", { level: 1, name: "Document types" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invoice" })).toBeVisible();

  await page.getByLabel("Key").fill(key);
  await page.getByLabel("Name", { exact: true }).fill("Store receipt");
  await submit(page, "Create type");
  await expect(page.getByRole("heading", { level: 1, name: "Store receipt" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Document type created");

  // Add a field and point the vision step at the demo connection.
  await page.locator('[name="fields.1.key"]').fill("total");
  await page.locator('[name="fields.1.label"]').fill("Total");
  await page.locator('[name="fields.1.type"]').selectOption("number");
  await page.locator('[name="steps.0.connectionId"]').selectOption("demo");
  await submit(page, "Save draft");
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await expect(page.locator('[name="fields.1.key"]')).toHaveValue("total");

  // Test bench: a sample with expected values, a test run, then publish.
  await page.getByRole("link", { name: /Test bench/u }).click();
  await page
    .getByLabel("Add samples")
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await submit(page, "Upload");
  await expect(page.getByRole("status")).toContainText("Samples added");
  await page.getByRole("link", { name: "receipt.png" }).click();
  await page.getByLabel("Number *").fill("DEMO-NUMBER");
  await page.getByLabel("Total").fill("1,234.50");
  await submit(page, "Save values");
  await expect(page.getByRole("status")).toContainText("Sample saved");

  await expect(page.getByRole("button", { name: "Publish v1" })).toBeDisabled();
  await submit(page, "Test this version on 1 sample");
  const results = page.getByRole("table", { name: "Results of This version" });
  await expect(results).toBeVisible();
  await expect(results.getByText("match")).toHaveCount(2, { timeout: 15_000 });

  await page.getByLabel("Model A").selectOption({ label: "Demo connection · Demo vision (fake)" });
  await page.getByLabel("Model B").selectOption({ label: "Demo connection · default model" });
  await submit(page, "Compare models");
  await expect(
    page.getByRole("table", { name: "Results of Demo connection · demo-vision" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Results of Demo connection · default model" }),
  ).toBeVisible();

  await submit(page, "Publish v1");
  await expect(page.getByRole("status")).toContainText("Version published");
  await expect(page.getByRole("button", { name: "New draft from v1" })).toBeVisible();
});

test("staff read a document, see where each value is, and follow the spend", async ({ page }) => {
  await page.goto("/admin/document-queue");
  await expect(page.getByRole("heading", { level: 1, name: "Document readings" })).toBeVisible();
  await page.getByRole("combobox", { name: "Type" }).selectOption("invoice");
  await page
    .getByLabel("File")
    .setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: png });
  await submit(page, "Read");

  await expect(page.getByRole("heading", { level: 1, name: "scan.png" })).toBeVisible();
  // `number` is a compact field: no dashes.
  await expect(page.getByRole("cell", { name: "DEMONUMBER", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-03-05", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^1\. text-layer/u })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^2\. vision-llm/u })).toBeVisible();
  await expect(page.getByRole("img", { name: "scan.png" })).toBeVisible();

  await page.goto("/admin/document-queue?state=done");
  await expect(page.getByRole("link", { name: "scan.png" }).first()).toBeVisible();

  await page.goto("/admin/document-usage");
  await expect(
    page.getByRole("heading", { level: 1, name: "Document reading usage" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: /demo-vision/u })).toBeVisible();
  await page.getByLabel("Monthly cap (US$)").fill("50");
  await submit(page, "Save cap");
  await expect(page.getByRole("status")).toContainText("Platform cap saved");
  await expect(page.getByRole("meter", { name: "Platform cap used" })).toBeVisible();
});

async function actAs(page: Page, role: string) {
  await page.goto("/admin");
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByLabel("Acting as").selectOption(role),
  ]);
  await expect(page.getByLabel("Acting as")).toHaveValue(role);
}

test("the documents pages are for staff", async ({ page }) => {
  await actAs(page, "viewer");
  await page.goto("/admin/document-types");
  await expect(page.getByText("Only platform staff can manage document types.")).toBeVisible();
  await page.goto("/admin/document-queue");
  await expect(page.getByText("Your readings, newest first.")).toBeVisible();
  await actAs(page, "admin");
});

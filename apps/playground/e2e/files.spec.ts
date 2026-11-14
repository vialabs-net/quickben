import { expect, test } from "@playwright/test";

// Single-tenant playground with the demo role switcher. `templates.spec.ts` uploads a brand
// logo in every mode.
test.skip(
  process.env.QUICKBEN_TENANCY === "1" || process.env.QUICKBEN_AUTH === "better-auth",
  "single-tenant playground with the role switcher only",
);

/** A 1x1 PNG. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

test("upload, preview, download and remove an author photo", async ({ page }) => {
  await page.goto("/admin/authors");
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeVisible();

  // A file of the wrong type is refused by the server, with a field error.
  const photo = page.getByLabel("Photo", { exact: true });
  await photo.setInputFiles({
    name: "notes.txt",
    mimeType: "image/png",
    buffer: Buffer.from("hi"),
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Files of type text\/plain are not accepted/)).toBeVisible();

  // The chosen image is previewed before it is saved.
  await photo.setInputFiles({ name: "ada.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "ada.png" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");

  // The stored file is shown and served by the route handlers.
  await page.reload();
  const link = page.getByRole("link", { name: "ada.png" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href")) ?? "";
  expect(href).toMatch(/^\/api\/authors\/[^/]+\/photo$/);
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(Buffer.from(await response.body())).toEqual(png);
  const download = await page.request.get(`${href}?download`);
  expect(download.headers()["content-disposition"]).toMatch(/^attachment; filename="ada.png"/);

  // Remove it.
  await page.getByRole("checkbox", { name: "Remove file" }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await page.reload();
  await expect(page.getByRole("link", { name: "ada.png" })).toHaveCount(0);
  expect((await page.request.get(href)).status()).toBe(404);
});

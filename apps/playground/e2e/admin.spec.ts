import { expect, test } from "@playwright/test";

// These tests use the single-tenant playground. `tenancy.spec.ts` covers QUICKBEN_TENANCY=1.
test.skip(process.env.QUICKBEN_TENANCY === "1", "single-tenant playground only");

test("list, create, edit and delete a post", async ({ page }) => {
  await page.goto("/admin/posts");
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await expect(page.getByRole("row")).not.toHaveCount(1);

  // Create, with a validation error first.
  await page.getByRole("link", { name: "New post" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New post" })).toBeVisible();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Smoke test post");
  await page.getByRole("textbox", { name: "Slug", exact: true }).fill("Not A Slug");
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByText("Use lowercase letters, digits and dashes")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("textbox", { name: "Slug", exact: true }).fill("smoke-test-post");
  await page.getByRole("combobox", { name: "Author" }).click();
  await page.getByRole("option", { name: "Ada Lovelace" }).click();
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("status")).toContainText("Post created");
  await expect(page.getByRole("heading", { level: 1, name: "Smoke test post" })).toBeVisible();

  // Edit.
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Smoke test post, edited");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("published");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(
    page.getByRole("heading", { level: 1, name: "Smoke test post, edited" }),
  ).toBeVisible();

  // It shows up in the list, filtered by status.
  await page.goto("/admin/posts?filter.status=published&q=smoke");
  await expect(page.getByRole("link", { name: "Smoke test post, edited" })).toBeVisible();

  // Delete.
  await page.getByRole("link", { name: "Smoke test post, edited" }).click();
  await page.getByRole("button", { name: "Delete post" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Post deleted");
  await expect(page.getByRole("link", { name: "Smoke test post, edited" })).toHaveCount(0);
});

test("the role switcher changes what the admin shows", async ({ page }) => {
  await page.goto("/admin");
  const sidebar = page.getByRole("navigation", { name: "Admin" });
  await expect(sidebar.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Acting as").selectOption("viewer");
  await expect(sidebar.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/admin/posts");
  await expect(page.getByRole("link", { name: "New post" })).toHaveCount(0);
  await page.getByLabel("Acting as").selectOption("admin");
  await expect(page.getByRole("link", { name: "New post" })).toBeVisible();
});

test("the public page and the API read through access rules", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Published posts" })).toBeVisible();
  const anonymous = await request.get(
    "/api/posts?where=" + encodeURIComponent('{"status":{"eq":"draft"}}'),
    {
      headers: { cookie: "qb-playground-role=anonymous" },
    },
  );
  expect(anonymous.ok()).toBe(true);
  expect((await anonymous.json()) as { docs: unknown[] }).toMatchObject({ docs: [] });
  const crossSite = await request.post("/api/tags", {
    data: { name: "blocked" },
    headers: { origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);
});

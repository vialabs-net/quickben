import { expect, test } from "@playwright/test";

// Runs only against the playground with QUICKBEN_CONNECTIONS=1.
test.skip(process.env.QUICKBEN_CONNECTIONS !== "1", "needs QUICKBEN_CONNECTIONS=1");

const SECRET = "sk-e2e-demo-secret-6789";

test("credentials and connections: create, test, refuse to delete in use", async ({
  page,
  request,
  baseURL,
}) => {
  // The generic HTTP provider tests the playground's own API, so no external service is used.
  const target = `${baseURL ?? ""}/api/_meta`;
  const suffix = String(Date.now());
  const credentialName = `Demo key ${suffix}`;
  const connectionName = `Playground API ${suffix}`;

  await page.goto("/admin");
  const sidebar = page.getByRole("navigation", { name: "Admin" });
  await expect(sidebar.getByRole("link", { name: "Connections" })).toBeVisible();

  // A credential: the secret is write-only.
  await sidebar.getByRole("link", { name: "Credentials" }).click();
  await expect(page).toHaveURL(/\/admin\/credentials$/);
  await expect(page.getByRole("heading", { level: 1, name: "Credentials" })).toBeVisible();
  await page.goto("/admin/credentials/new");
  await page.getByRole("textbox", { name: "Name" }).fill(credentialName);
  await page.getByLabel("Secret").fill(SECRET);
  await page.getByRole("button", { name: "Create credential" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Credential created" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: credentialName })).toBeVisible();
  await expect(page.getByText("•••• 6789").first()).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);

  // Unused: Test asks for a provider.
  await page.getByRole("button", { name: "Test" }).click();
  const dialog = page.getByRole("dialog", { name: "Test the credential" });
  await dialog.getByLabel("Provider").selectOption("http");
  await dialog.getByLabel("Base URL").fill(target);
  await dialog.getByRole("button", { name: "Test" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The credential works" })).toBeVisible();

  // A connection: provider picker grouped by category, then the provider's form.
  await page.goto("/admin/connections");
  await expect(page.getByRole("link", { name: "New connection" })).toBeVisible();
  await page.goto("/admin/connections/new");
  await expect(page.getByRole("heading", { level: 2, name: "AI models" })).toBeVisible();
  await page.getByRole("link", { name: /HTTP API/ }).click();
  await expect(page).toHaveURL(/provider=http/);
  await page.getByRole("textbox", { name: "Name" }).fill(connectionName);
  await page.getByRole("textbox", { name: "Base URL" }).fill(target);
  await page.getByLabel("Credential").selectOption({ label: `${credentialName} (•••• 6789)` });
  await page.getByRole("button", { name: "Create connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connection created" })).toBeVisible();
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The connection works" })).toBeVisible();
  await expect(page.getByText("Working")).toBeVisible();

  // A credential in use cannot be deleted.
  await page.goto("/admin/credentials");
  await page.getByRole("link", { name: credentialName }).click();
  await expect(page).toHaveURL(/\/admin\/credentials\/.+/);
  await expect(page.getByRole("link", { name: connectionName })).toBeVisible();
  await page.getByRole("button", { name: "Delete credential" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "used by 1 connection" })).toBeVisible();

  // The REST API never returns the secret.
  const response = await request.get("/api/credentials");
  expect(response.ok()).toBe(true);
  const body = await response.text();
  expect(body).toContain(credentialName);
  expect(body).not.toContain(SECRET);
  expect(body).not.toContain("v1:");
});

test("credentials are hidden from users who are not admins", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Acting as").selectOption("editor");
  const sidebar = page.getByRole("navigation", { name: "Admin" });
  await expect(sidebar.getByRole("link", { name: "Posts" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Credentials" })).toHaveCount(0);
  await page.getByLabel("Acting as").selectOption("admin");
});

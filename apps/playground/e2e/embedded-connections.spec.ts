import { expect, test } from "@playwright/test";

// The connections pages inside the embedded host layout. Runs only with QUICKBEN_CONNECTIONS=1,
// single tenant, in English.
test.skip(
  process.env.QUICKBEN_CONNECTIONS !== "1" ||
    process.env.QUICKBEN_TENANCY === "1" ||
    process.env.QUICKBEN_AUTH === "better-auth" ||
    (process.env.QUICKBEN_LOCALE ?? "en") !== "en",
  "needs QUICKBEN_CONNECTIONS=1, single tenant, English",
);

test("edit the models of a connection as rows, in embedded mode", async ({ page }) => {
  const suffix = String(Date.now());
  const credentialName = `Embedded key with a rather long name to check the picker ${suffix}`;
  const connectionName = `Embedded Claude ${suffix}`;

  await page.goto("/embedded/credentials/new");
  await page.getByRole("textbox", { name: "Name" }).fill(credentialName);
  await page.getByLabel("Secret").fill("sk-embedded-secret-4321");
  await page.getByRole("button", { name: "Create credential" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Credential created" })).toBeVisible();

  await page.goto("/embedded/connections/new?provider=anthropic");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator(".host-title h1").filter({ visible: true })).toHaveText(
    "New connection",
  );
  await page.getByRole("textbox", { name: "Name" }).fill(connectionName);

  // The credential picker fits its column; the full label is in the open list.
  const credential = page.getByLabel("Credential");
  await credential.selectOption({ label: `${credentialName} (•••• 4321)` });
  const select = await credential.boundingBox();
  const column = await credential.locator("xpath=../..").boundingBox();
  expect(select && column && select.x + select.width <= column.x + column.width + 1).toBe(true);
  await expect(credential).toHaveAttribute("title", `${credentialName} (•••• 4321)`);

  // Models: a row editor, not JSON text.
  const models = page.getByRole("group", { name: "Models" });
  await expect(models.getByText("No rows yet.")).toBeVisible();
  await models.getByRole("button", { name: "Add row" }).click();
  await expect(models.getByLabel("Model id, row 1")).toBeFocused();
  await models.getByLabel("Model id, row 1").fill("claude-a");
  await models.getByLabel("Input USD / 1M tokens, row 1", { exact: true }).fill("1.5");
  await models.getByRole("button", { name: "Add row" }).click();
  await models.getByLabel("Model id, row 2").fill("claude-b");
  await models.getByLabel("Default, row 2").check();
  await models.getByRole("button", { name: "Move row 2 up" }).click();
  await expect(models.getByLabel("Model id, row 1")).toHaveValue("claude-b");
  await models.getByRole("button", { name: "Add row" }).click();
  await models.getByLabel("Model id, row 3").fill("claude-c");
  await models.getByRole("button", { name: "Remove row 3" }).click();
  await expect(models.getByLabel("Model id, row 3")).toHaveCount(0);

  await page.getByRole("button", { name: "Create connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connection created" })).toBeVisible();
  await expect(page).toHaveURL(/\/embedded\/connections\/[^/?]+/);
  await expect(page.locator(".host-title h1").filter({ visible: true })).toHaveText(connectionName);
  const editUrl = new URL(page.url()).pathname;

  // Stored in order, defaults filled.
  const saved = page.getByRole("group", { name: "Models" });
  await expect(saved.getByLabel("Model id, row 1")).toHaveValue("claude-b");
  await expect(saved.getByLabel("Default, row 1")).toBeChecked();
  await expect(saved.getByLabel("Model id, row 2")).toHaveValue("claude-a");
  await expect(saved.getByLabel("Input USD / 1M tokens, row 2", { exact: true })).toHaveValue(
    "1.5",
  );

  // A duplicate id: the error is on the cell.
  await saved.getByLabel("Model id, row 2").fill("claude-b");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(saved.getByLabel("Model id, row 2")).toHaveAttribute("aria-invalid", "true");
  await expect(saved.getByText("Duplicate model claude-b").first()).toBeVisible();
  await expect(saved.getByLabel("Model id, row 2")).toBeFocused();

  // Raw JSON stays available.
  await saved.getByRole("button", { name: "Edit as JSON" }).click();
  const json = page.locator("textarea[name='metadata.models']");
  await expect(json).toHaveValue(/"claude-b"/);
  await json.fill('[{ "id": "claude-z" }]');
  await page.getByRole("button", { name: "Edit as JSON" }).click();
  await expect(
    page.getByRole("group", { name: "Models" }).getByLabel("Model id, row 1"),
  ).toHaveValue("claude-z");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes saved" })).toBeVisible();

  // The list: search by name and filter by provider.
  await page.goto(`/embedded/connections?q=${encodeURIComponent(connectionName)}`);
  await expect(page.getByRole("link", { name: connectionName })).toBeVisible();
  await page.getByLabel("Provider").selectOption({ label: "HTTP API" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/filter\.provider=http/);
  await expect(page.getByRole("link", { name: connectionName })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page.getByRole("link", { name: connectionName })).toBeVisible();

  // On a phone, tables and the row editor scroll inside their box; the page never does.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ["/embedded/connections", "/embedded/credentials", editUrl]) {
    await page.goto(url);
    await expect(page.getByRole("table").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
});

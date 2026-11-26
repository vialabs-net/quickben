import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ui/selects");
});

test("select chevrons follow the nearest direction override", async ({ page }) => {
  await page.locator("#light-default").evaluate((select) => {
    const host = document.createElement("div");
    host.dir = "rtl";
    host.innerHTML = `
      <select id="inherited-rtl"><option>Draft</option></select>
      <select id="explicit-ltr" dir="ltr"><option>Draft</option></select>
      <div dir="ltr">
        <select id="inherited-ltr"><option>Draft</option></select>
        <div dir="rtl"><select id="nested-rtl"><option>Draft</option></select></div>
      </div>`;
    select.parentElement?.append(host);
  });
  for (const id of ["inherited-rtl", "nested-rtl"]) {
    await expect(page.locator(`#${id}`)).toHaveCSS("direction", "rtl");
    await expect(page.locator(`#${id}`)).toHaveCSS("background-position", /^12px /);
    await expect(page.locator(`#${id}`)).toHaveCSS("padding-left", "32px");
  }
  for (const id of ["explicit-ltr", "inherited-ltr"]) {
    await expect(page.locator(`#${id}`)).toHaveCSS("direction", "ltr");
    await expect(page.locator(`#${id}`)).toHaveCSS("background-position", /^calc\(100% - 17px\)/);
    await expect(page.locator(`#${id}`)).toHaveCSS("padding-right", "32px");
  }
  await page.locator("html").evaluate((html) => {
    html.dir = "rtl";
  });
  await expect(page.locator("#light-default")).toHaveCSS("background-position", /^12px /);
});

test("forced colors restore the native select arrow", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  for (const selector of ["#light-default", "#dark-default", '[data-testid="pill-light"] select']) {
    await expect(page.locator(selector)).toHaveCSS("appearance", "auto");
    await expect(page.locator(selector)).toHaveCSS("background-image", "none");
  }
});

test("multiple and expanded selects stay native and apps can override the base", async ({
  page,
}) => {
  const select = page.locator("#light-raw");
  for (const size of ["2", "4"]) {
    await select.evaluate((element, value) => {
      element.setAttribute("size", value);
    }, size);
    await expect(select).toHaveCSS("appearance", "auto");
    await expect(select).toHaveCSS("background-image", "none");
  }
  for (const size of ["0", "1"]) {
    await select.evaluate((element, value) => {
      element.setAttribute("size", value);
    }, size);
    await expect(select).toHaveCSS("appearance", "none");
  }
  await expect(page.locator("#light-multiple")).toHaveCSS("appearance", "auto");
  await expect(page.locator("#light-multiple")).toHaveCSS("background-image", "none");
  await page.addStyleTag({
    content: "select { background-image: none; padding-inline-end: 48px; }",
  });
  await expect(select).toHaveCSS("background-image", "none");
  await expect(select).toHaveCSS("padding-inline-end", "48px");
});

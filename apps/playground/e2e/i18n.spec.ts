import { expect, test } from "@playwright/test";

// The admin in Spanish: start the playground with QUICKBEN_LOCALE=es.
test.skip(process.env.QUICKBEN_LOCALE !== "es", "runs with QUICKBEN_LOCALE=es");
test.skip(
  process.env.QUICKBEN_TENANCY === "1" || process.env.QUICKBEN_AUTH === "better-auth",
  "single-tenant playground with the role switcher only",
);

test("the shell and dashboard are in Spanish", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator(".qb-root")).toHaveAttribute("lang", "es");
  const sidebar = page.getByRole("navigation", { name: "Administración" });
  await expect(sidebar.getByRole("link", { name: "Panel" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByText("Contenido", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Publicaciones" })).toBeVisible();
  await expect(page.getByText("Colecciones a las que tienes acceso.")).toBeVisible();
});

test("list, create, edit and delete a post in Spanish", async ({ page }) => {
  await page.goto("/admin/posts");
  await expect(page.getByRole("heading", { level: 1, name: "Publicaciones" })).toBeVisible();
  await expect(page.getByText(/^Mostrando 1–\d+ de \d+$/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Título" })).toBeVisible();

  // Create, with a validation error from the admin first.
  await page.getByRole("link", { name: "Crear publicación" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Crear publicación" })).toBeVisible();
  await page.getByRole("textbox", { name: "Título", exact: true }).fill("Prueba en español");
  await page.getByRole("textbox", { name: "Slug", exact: true }).fill("prueba-en-espanol");
  await page.getByRole("button", { name: "Crear publicación" }).click();
  await expect(page.getByRole("status")).toContainText("Publicación: registro creado");
  await expect(page.getByRole("heading", { level: 1, name: "Prueba en español" })).toBeVisible();
  await expect(page.getByText("Detalles")).toBeVisible();

  // Edit.
  await page.getByRole("textbox", { name: "Título", exact: true }).fill("Prueba editada");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status")).toContainText("Cambios guardados");

  // Search and filter in Spanish.
  await page.goto("/admin/posts?q=prueba");
  await expect(page.getByRole("button", { name: "Aplicar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Limpiar" })).toBeVisible();

  // Delete.
  await page.getByRole("link", { name: "Prueba editada" }).click();
  await page.getByRole("button", { name: "Eliminar publicación" }).click();
  await expect(page.getByText("¿Eliminar «Prueba editada»? No se puede deshacer.")).toBeVisible();
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Publicación: registro eliminado");
});

test("field errors are in Spanish", async ({ page }) => {
  await page.goto("/admin/settings/new");
  await page.getByRole("textbox", { name: "Clave", exact: true }).fill("i18n-check");
  await page.locator("textarea[name=value]").fill("{ not json");
  await expect(page.getByText(/^JSON no válido:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Formatear" })).toBeDisabled();
});

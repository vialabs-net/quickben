import {
  defineCollection,
  defineConfig,
  definePlugin,
  fields as f,
  getQuickben,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { getMeta } from "../src";

const clients = defineCollection({
  slug: "clients",
  labels: { plural: { en: "Clients", es: "Clientes" } },
  fields: {
    name: f.text({
      label: { en: "Name", es: "Nombre" },
      description: { en: "Full", es: "Completo" },
    }),
  },
  access: { read: () => true },
  admin: { group: { en: "Sales", es: "Ventas" }, description: { en: "People", es: "Personas" } },
});

const config = defineConfig({
  db: memoryAdapter(),
  collections: [clients],
  admin: { title: { en: "Back office", es: "Oficina" } },
  plugins: [
    definePlugin({
      name: "crm",
      modules: [
        {
          key: "crm",
          label: { en: "CRM", es: "Comercial" },
          collections: ["clients"],
          nav: [{ label: { en: "All clients", es: "Todos" }, collection: "clients" }],
        },
      ],
    }),
  ],
});

describe("getMeta with a locale", () => {
  it("resolves per-locale labels", async () => {
    const qb = await getQuickben(config);
    const meta = await getMeta(qb, { user: null }, { locale: "es-CL" });
    expect(meta.title).toBe("Oficina");
    const [collection] = meta.collections;
    expect(collection?.labels).toEqual({ singular: "Cliente", plural: "Clientes" });
    expect(collection?.fields[0]).toMatchObject({ label: "Nombre", description: "Completo" });
    expect(collection?.admin).toMatchObject({ group: "Ventas", description: "Personas" });
    expect(meta.modules[0]).toMatchObject({ label: "Comercial", nav: [{ label: "Todos" }] });
  });

  it("uses English by default", async () => {
    const qb = await getQuickben(config);
    const meta = await getMeta(qb, { user: null });
    expect(meta.title).toBe("Back office");
    expect(meta.collections[0]?.labels.plural).toBe("Clients");
  });
});

describe("row columns of json fields", () => {
  it("describes lists of objects and leaves other json fields alone", async () => {
    const models = z.array(z.object({ id: z.string(), price: z.number().min(0).default(0) }));
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [
        defineCollection({
          slug: "llms",
          fields: {
            models: f.json({ schema: models }),
            again: f.json({ schema: models }),
            settings: f.json({ schema: z.object({ a: z.string() }) }),
            free: f.json(),
          },
          access: { read: () => true },
        }),
      ],
    });
    const qb = await getQuickben(config);
    const meta = await getMeta(qb, { user: null });
    const fields = meta.collections[0]?.fields ?? [];
    const rows = (name: string) => fields.find((field) => field.name === name)?.rows;
    expect(rows("models")?.map((column) => [column.key, column.type])).toEqual([
      ["id", "text"],
      ["price", "number"],
    ]);
    expect(rows("again")).toEqual(rows("models"));
    expect(rows("settings")).toBeUndefined();
    expect(rows("free")).toBeUndefined();
  });
});

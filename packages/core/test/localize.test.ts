import { describe, expect, it } from "vitest";

import { defineCollection, fields, localeChain, localize, mapLocalized } from "../src";

describe("localize", () => {
  it("returns strings as they are", () => {
    expect(localize("Posts", "es")).toBe("Posts");
    expect(localize(undefined, "es")).toBe("");
  });

  it("picks the locale, then the language, then English, then the first value", () => {
    const text = { en: "Posts", es: "Entradas", "es-CL": "Publicaciones" };
    expect(localize(text, "es-CL")).toBe("Publicaciones");
    expect(localize(text, "es-MX")).toBe("Entradas");
    expect(localize(text, "fr")).toBe("Posts");
    expect(localize(text)).toBe("Posts");
    expect(localize({ de: "Beiträge" }, "fr")).toBe("Beiträge");
    expect(localize({}, "fr")).toBe("");
  });

  it("builds the locale chain", () => {
    expect(localeChain("zh-Hant-TW")).toEqual(["zh-Hant-TW", "zh-Hant", "zh", "en"]);
    expect(localeChain("en")).toEqual(["en"]);
    expect(localeChain(undefined)).toEqual(["en"]);
  });

  it("maps strings and records", () => {
    expect(mapLocalized("a", (v) => v.toUpperCase())).toBe("A");
    expect(mapLocalized({ en: "a", es: "b" }, (v) => v.toUpperCase())).toEqual({
      en: "A",
      es: "B",
    });
  });

  it("derives per-locale singular labels", () => {
    const clients = defineCollection({
      slug: "clients",
      labels: { plural: { en: "Clients", es: "Clientes" } },
      fields: { name: fields.text({ label: { en: "Name", es: "Nombre" } }) },
    });
    expect(clients.labels.singular).toEqual({ en: "Client", es: "Cliente" });
  });
});

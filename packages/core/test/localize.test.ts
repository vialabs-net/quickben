import { describe, expect, it } from "vitest";

import {
  defineCollection,
  defineConfig,
  fields,
  localeChain,
  localeFromRequest,
  localize,
  mapLocalized,
  negotiateLocale,
} from "../src";

import { testAdapter } from "./helpers";

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

describe("negotiateLocale", () => {
  it("follows q values and keeps the region", () => {
    expect(negotiateLocale("es-CL,es;q=0.9,en;q=0.8", ["en", "es"])).toBe("es-CL");
    expect(negotiateLocale("fr;q=0.5,EN-us;q=0.8", ["en-US", "es"])).toBe("en-US");
    expect(negotiateLocale("de, *;q=0.1", ["en", "es"])).toBe("en");
    expect(negotiateLocale("es;q=0", ["en", "es"], "es")).toBe("es");
    expect(negotiateLocale(null, [])).toBe("en");
  });

  it("reads the cookie first", () => {
    const resolve = localeFromRequest({ supported: ["en", "es"], cookie: "locale" });
    const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });
    expect(resolve(req({ cookie: "a=1; locale=es", "accept-language": "en" }))).toBe("es");
    expect(resolve(req({ cookie: "locale=fr", "accept-language": "es-MX" }))).toBe("es-MX");
    expect(resolve(req({ cookie: "locale=%E0%A4%A", "accept-language": "de" }))).toBe("en");
    expect(resolve(undefined)).toBe("en");
    expect(localeFromRequest({ supported: [] })(req({}))).toBe("en");
  });
});

describe("admin config", () => {
  it("keeps locale, messages and timeZone", () => {
    const locale = () => "es";
    const config = defineConfig({
      db: testAdapter(),
      collections: [],
      admin: { locale, messages: { es: { "admin.nav.dashboard": "Inicio" } }, timeZone: "UTC" },
    });
    expect(config.admin).toEqual({
      title: "Quickben",
      meta: {},
      locale,
      messages: { es: { "admin.nav.dashboard": "Inicio" } },
      timeZone: "UTC",
    });
  });
});

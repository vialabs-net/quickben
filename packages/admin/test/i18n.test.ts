import { defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";

import {
  adminMessages,
  canonicalLocale,
  createAdminI18n,
  defineMessages,
  englishI18n,
  formatMessage,
  missingMessages,
  resolveAdminI18nData,
  resolveAdminLocale,
} from "../src/i18n";
import { flattenOverrides } from "../src/i18n/resolve";

const es = createAdminI18n({ locale: "es-CL", timeZone: "UTC", overrides: {} });

const reports = defineMessages("reports", {
  en: { title: "Reports", count: { one: "{count} report", other: "{count} reports" } },
  es: { title: "Informes", count: { one: "{count} informe", other: "{count} informes" } },
});

describe("catalogs", () => {
  it("ships a complete Spanish catalog", () => {
    expect(missingMessages(adminMessages)).toEqual([]);
    expect(Object.keys(adminMessages.locales)).toEqual(["en", "es"]);
  });

  it("reports missing, unknown and extra placeholders", () => {
    const broken = {
      namespace: "x",
      locales: {
        en: { a: "A {name}", b: "B" },
        es: { a: "A {other}", c: "C" },
      },
    };
    expect(missingMessages(broken)).toEqual([
      { locale: "es", key: "a", problem: "placeholders" },
      { locale: "es", key: "b", problem: "missing" },
      { locale: "es", key: "c", problem: "unknown" },
    ]);
  });

  it("checks namespaces", () => {
    expect(() => defineMessages("Bad Name", { en: {} })).toThrow(TypeError);
  });
});

describe("formatMessage", () => {
  it("replaces placeholders and formats numbers for the locale", () => {
    expect(formatMessage("{a} of {b}", "es", { a: 1234.5, b: "x" })).toBe("1234,5 of x");
    expect(formatMessage("{a} of {b}", "en", { a: 1234.5 })).toBe("1,234.5 of {b}");
  });

  it("chooses plural forms with Intl.PluralRules", () => {
    const message = { one: "{count} item", other: "{count} items" };
    expect(formatMessage(message, "en", { count: 1 })).toBe("1 item");
    expect(formatMessage(message, "en", { count: 2 })).toBe("2 items");
    expect(formatMessage(message, "en")).toBe("{count} items");
    expect(formatMessage({ other: "x", few: "few" }, "pl", { count: 3 })).toBe("few");
  });
});

describe("translator", () => {
  it("translates admin and scoped messages, with English fallback", () => {
    expect(englishI18n.t("nav.dashboard")).toBe("Dashboard");
    expect(es.t("nav.dashboard")).toBe("Panel");
    expect(es.scope(reports).t("count", { count: 1 })).toBe("1 informe");
    const fr = createAdminI18n({ locale: "fr", timeZone: "UTC", overrides: {} });
    expect(fr.scope(reports).t("title")).toBe("Reports");
    expect(fr.scope(reports).t("missing" as "title")).toBe("reports.missing");
  });

  it("applies overrides first", () => {
    const custom = createAdminI18n({
      locale: "es",
      timeZone: "UTC",
      overrides: { "admin.nav.dashboard": "Inicio", "reports.title": "Reportes" },
    });
    expect(custom.t("nav.dashboard")).toBe("Inicio");
    expect(custom.scope(reports).t("title")).toBe("Reportes");
  });

  it("formats dates, numbers, lists and relative times", () => {
    expect(es.number(1234.5)).toBe("1.234,5");
    expect(es.date("2026-11-13")).toBe("13-11-2026");
    expect(
      createAdminI18n({ locale: "es", timeZone: "UTC", overrides: {} }).date("2026-11-13"),
    ).toBe("13 nov 2026");
    expect(englishI18n.date("2026-11-13")).toBe("Nov 13, 2026");
    expect(englishI18n.dateTime("2026-11-13T14:05:00Z")).toMatch(/^Nov 13, 2026, 2:05\sPM UTC$/);
    const santiago = createAdminI18n({ locale: "en", timeZone: "America/Santiago", overrides: {} });
    expect(santiago.dateTime("2026-01-13T14:05:00Z")).toMatch(/11:05/);
    expect(santiago.date("2026-01-13")).toBe("Jan 13, 2026");
    expect(englishI18n.dateTime("nope")).toBe("nope");
    expect(englishI18n.date("nope")).toBe("nope");
    expect(englishI18n.list(["a", "b", "c"])).toBe("a, b, and c");
    expect(es.list(["a", "b"], "disjunction")).toBe("a o b");
    const now = "2026-11-13T12:00:00Z";
    expect(englishI18n.relativeTime("2026-11-12T12:00:00Z", now)).toBe("yesterday");
    expect(es.relativeTime("2026-11-13T14:00:00Z", now)).toBe("dentro de 2 horas");
    expect(englishI18n.relativeTime(now, now)).toBe("now");
    expect(englishI18n.relativeTime("bad", now)).toBe("bad");
    expect(englishI18n.text({ en: "Posts", es: "Entradas" })).toBe("Posts");
    expect(es.text({ en: "Posts", es: "Entradas" })).toBe("Entradas");
    expect(es.text(null)).toBe("");
    expect(createAdminI18n({ locale: "tr", timeZone: "UTC", overrides: {} }).lower("I")).toBe("ı");
  });
});

describe("resolve", () => {
  const config = defineConfig({
    db: memoryAdapter(),
    collections: [],
    admin: {
      locale: (req) => req?.headers.get("x-locale") ?? undefined,
      messages: {
        es: { "admin.nav.dashboard": "Inicio" },
        "es-CL": { "admin.nav.pages": "Hojas" },
      },
      timeZone: "America/Santiago",
    },
  });
  const req = (locale: string) =>
    new Request("https://x.test/", { headers: { "x-locale": locale } });

  it("reads the locale from options, then the config function, then en", async () => {
    expect(await resolveAdminLocale(config, { locale: "es" }, undefined)).toBe("es");
    expect(await resolveAdminLocale(config, {}, req("es-cl"))).toBe("es-CL");
    expect(await resolveAdminLocale(config, {}, undefined)).toBe("en");
    expect(await resolveAdminLocale(config, {}, req("not a locale!"))).toBe("en");
    expect(canonicalLocale(undefined)).toBeNull();
  });

  it("merges overrides, most specific locale first", async () => {
    const data = await resolveAdminI18nData(
      config,
      { messages: { es: { "admin.nav.links": "Vínculos" } } },
      req("es-CL"),
    );
    expect(data).toEqual({
      locale: "es-CL",
      timeZone: "America/Santiago",
      overrides: {
        "admin.nav.dashboard": "Inicio",
        "admin.nav.links": "Vínculos",
        "admin.nav.pages": "Hojas",
      },
    });
    expect(flattenOverrides("es", [{ en: { a: "A" }, es: { a: "B" } }, undefined])).toEqual({
      a: "B",
    });
  });

  it("falls back to UTC for an unknown time zone", async () => {
    const data = await resolveAdminI18nData(config, { timeZone: "Mars/Olympus" }, undefined);
    expect(data.timeZone).toBe("UTC");
  });
});

import { describe, expectTypeOf, it } from "vitest";

import { defineMessages, englishI18n } from "../src/i18n";

import type {
  AdminChrome,
  AdminCrumb,
  AdminExtension,
  AdminMessageKey,
  AdminNav,
  AdminOptions,
  AdminPageInfo,
  AdminPageTitle,
  AdminText,
  MessageBundle,
  PageProps,
  Translator,
} from "../src";
import type { FullMessageKey, MessageKey } from "../src/i18n";
import type { ListToolbarFilter, ListToolbarProps, RowsEditorProps } from "../src/ui";
import type { JsonRowColumn, LocalizedText } from "@quickben/core";
import type { FieldMeta } from "@quickben/next";

const reports = defineMessages("reports", {
  en: { title: "Reports", count: { one: "{count} report", other: "{count} reports" } },
  es: { title: "Informes", count: { one: "{count} informe", other: "{count} informes" } },
});

describe("message catalogs", () => {
  it("infers keys from English", () => {
    expectTypeOf<MessageKey<typeof reports>>().toEqualTypeOf<"title" | "count">();
    expectTypeOf<FullMessageKey<typeof reports>>().toEqualTypeOf<
      "reports.title" | "reports.count"
    >();
    expectTypeOf(reports).toExtend<MessageBundle<"reports", "title" | "count">>();
  });

  it("requires every English key in other locales", () => {
    expectTypeOf(defineMessages).toBeFunction();
    defineMessages("partial", {
      en: { a: "A", b: "B" },
      // @ts-expect-error -- `b` is missing
      es: { a: "A" },
    });
  });

  it("types translator keys", () => {
    const t = englishI18n.scope(reports).t;
    expectTypeOf(t).toEqualTypeOf<Translator<"title" | "count">["t"]>();
    // @ts-expect-error -- unknown key
    t("nope");
    // @ts-expect-error -- unknown admin key
    englishI18n.t("nope");
    expectTypeOf<"nav.dashboard">().toExtend<AdminMessageKey>();
  });
});

describe("options", () => {
  it("accepts locale, messages, chrome and catalogs", () => {
    expectTypeOf<AdminOptions["chrome"]>().toEqualTypeOf<AdminChrome | undefined>();
    expectTypeOf<AdminChrome>().toEqualTypeOf<"full" | "none">();
    const options: AdminOptions = {
      locale: (req) => req?.headers.get("x-locale") ?? "en",
      messages: { es: { "admin.nav.dashboard": "Inicio" } },
      timeZone: "America/Santiago",
      chrome: "none",
      catalogs: [reports],
    };
    expectTypeOf(options).toExtend<AdminExtension>();
    expectTypeOf<LocalizedText>().toExtend<AdminText>();
    expectTypeOf<PageProps["i18n"]["locale"]>().toEqualTypeOf<string>();
    expectTypeOf<AdminNav["groups"][number]["links"][number]["active"]>().toEqualTypeOf<boolean>();
  });
});

describe("0.3.x additions", () => {
  it("types the page title option and the page info of the nav", () => {
    expectTypeOf<AdminPageTitle>().toEqualTypeOf<"render" | "none">();
    expectTypeOf<AdminOptions["pageTitle"]>().toEqualTypeOf<AdminPageTitle | undefined>();
    expectTypeOf<AdminNav["page"]>().toEqualTypeOf<AdminPageInfo | null | undefined>();
    expectTypeOf<AdminPageInfo["crumbs"]>().toEqualTypeOf<AdminCrumb[]>();
  });

  it("types the row editor and the list toolbar", () => {
    expectTypeOf<RowsEditorProps["columns"]>().toEqualTypeOf<readonly JsonRowColumn[]>();
    expectTypeOf<RowsEditorProps["cellId"]>().toEqualTypeOf<
      ((row: number, key: string) => string) | undefined
    >();
    expectTypeOf<ListToolbarProps["filters"]>().toEqualTypeOf<
      readonly ListToolbarFilter[] | undefined
    >();
    expectTypeOf<FieldMeta["rows"]>().toEqualTypeOf<JsonRowColumn[] | undefined>();
  });
});

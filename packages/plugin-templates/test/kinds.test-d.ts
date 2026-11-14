import { describe, expectTypeOf, it } from "vitest";

import { defineTemplateKind } from "../src";

import type { CatalogVariable, TemplateKindDefinition, TemplateSummary } from "../src";
import type { LocalizedText } from "@quickben/core";

describe("localized labels", () => {
  it("takes a string or per-locale labels for kinds and variables", () => {
    defineTemplateKind({
      kind: "invoice",
      label: { en: "Invoice", es: "Factura" },
      description: { en: "Sent to customers.", es: "Se envía a los clientes." },
      catalog: [
        { path: "customer.name", label: { en: "Customer", es: "Cliente" } },
        { path: "total", label: "Total" },
      ],
    });
    expectTypeOf<TemplateKindDefinition["label"]>().toEqualTypeOf<LocalizedText>();
    expectTypeOf<TemplateKindDefinition["description"]>().toEqualTypeOf<
      LocalizedText | undefined
    >();
    expectTypeOf<CatalogVariable["label"]>().toEqualTypeOf<LocalizedText>();
    expectTypeOf<TemplateSummary["label"]>().toEqualTypeOf<LocalizedText>();
  });

  it("refuses other label types", () => {
    expectTypeOf<number>().not.toExtend<TemplateKindDefinition["label"]>();
    defineTemplateKind({
      kind: "x",
      // @ts-expect-error a label is text
      label: 1,
      catalog: [],
    });
    defineTemplateKind({
      kind: "y",
      label: "Y",
      // @ts-expect-error per-locale labels are strings
      catalog: [{ path: "a", label: { en: 1 } }],
    });
  });
});

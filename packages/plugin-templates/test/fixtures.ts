import { createQuickben, defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

import { defineTemplateKind, templates } from "../src";

import type { TemplateNode, TemplatesOptions } from "../src";
import type { QuickbenUser, RequestContext } from "@quickben/core";

export const doc = (...content: TemplateNode[]) => ({ type: "doc" as const, content });
export const p = (...content: TemplateNode[]): TemplateNode => ({ type: "paragraph", content });
export const text = (value: string): TemplateNode => ({ type: "text", text: value });
export const v = (path: string, attrs: Record<string, unknown> = {}): TemplateNode => ({
  type: "variable",
  attrs: { path, ...attrs },
});
export const signature: TemplateNode = {
  type: "signature",
  attrs: { caption: "Customer" },
  content: [v("customer.name")],
};

/** An invoice kind with every variable type. */
export const invoice = defineTemplateKind({
  kind: "invoice",
  label: "Invoice",
  description: "Sent to customers.",
  requireSignature: true,
  catalog: [
    { path: "customer.name", label: "Customer name", group: "Customer", sample: "Ada Lovelace" },
    {
      path: "customer.type",
      label: "Customer type",
      group: "Customer",
      type: "enum",
      values: [
        { value: "person", label: "Person" },
        { value: "company", label: "Company" },
      ],
      sample: "company",
    },
    { path: "invoice.number", label: "Invoice number", sample: "INV-0042" },
    { path: "invoice.total", label: "Total", type: "number", sample: 1234.5 },
    { path: "invoice.date", label: "Date", type: "date", sample: "2026-11-06" },
    { path: "invoice.paid", label: "Paid", type: "boolean", sample: true },
    {
      path: "invoice.lines",
      label: "Lines",
      type: "list",
      fields: [
        { key: "item", label: "Item" },
        { key: "amount", label: "Amount" },
      ],
      sample: [{ item: "Consulting", amount: 1000 }],
    },
    {
      path: "invoice.currency",
      label: "Currency",
      format: (value) => `[${String(value)}]`,
      sample: "EUR",
    },
  ],
  baseTemplate: doc(
    { type: "heading", attrs: { level: 1 }, content: [text("Invoice "), v("invoice.number")] },
    p(text("Bill to "), v("customer.name")),
    signature,
  ),
});

/** A kind without a base template. */
export const letter = defineTemplateKind({
  kind: "letter",
  label: "Letter",
  catalog: [{ path: "recipient", label: "Recipient" }],
});

export const system: RequestContext = { user: null, overrideAccess: true };
export const alice: QuickbenUser = { id: "alice", email: "alice@example.com" };
export const as = (user: QuickbenUser | null): RequestContext => ({ user });

export function makeConfig(options: Partial<TemplatesOptions> = {}) {
  return defineConfig({
    db: memoryAdapter(),
    collections: [],
    plugins: [templates({ kinds: [invoice, letter], ...options })],
  });
}

export async function setup(options: Partial<TemplatesOptions> = {}) {
  return createQuickben(makeConfig(options));
}

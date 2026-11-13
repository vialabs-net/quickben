import { defineTemplateKind } from "@quickben/plugin-templates";

/**
 * Document templates demo switch. Start the playground with `QUICKBEN_TEMPLATES=1` to add
 * `@quickben/plugin-templates`: the admin gets a Templates page (editor with live preview and
 * publishing) and a Brand page. With `QUICKBEN_TENANCY=1` too, each organization has its own.
 */
export const templatesEnabled = process.env.QUICKBEN_TEMPLATES === "1";

/** A demo kind: an invoice with every variable type. */
export const invoice = defineTemplateKind({
  kind: "invoice",
  label: "Invoice",
  description: "Sent to customers when an order ships.",
  requireSignature: false,
  catalog: [
    { path: "customer.name", label: "Customer name", group: "Customer", sample: "Ada Lovelace" },
    {
      path: "customer.email",
      label: "Customer email",
      group: "Customer",
      sample: "ada@example.com",
    },
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
    { path: "invoice.number", label: "Invoice number", group: "Invoice", sample: "INV-0042" },
    { path: "invoice.date", label: "Date", group: "Invoice", type: "date", sample: "2026-11-06" },
    { path: "invoice.total", label: "Total", group: "Invoice", type: "number", sample: 1250 },
    { path: "invoice.paid", label: "Paid", group: "Invoice", type: "boolean", sample: false },
    {
      path: "invoice.lines",
      label: "Lines",
      group: "Invoice",
      type: "list",
      fields: [
        { key: "item", label: "Item" },
        { key: "amount", label: "Amount" },
      ],
      sample: [
        { item: "Design", amount: "1,000.00" },
        { item: "Hosting", amount: "250.00" },
      ],
    },
  ],
  baseTemplate: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [
          { type: "text", text: "Invoice " },
          { type: "variable", attrs: { path: "invoice.number" } },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Billed to " },
          { type: "variable", attrs: { path: "customer.name" }, marks: [{ type: "bold" }] },
          { type: "text", text: " on " },
          { type: "variable", attrs: { path: "invoice.date" } },
          { type: "text", text: "." },
        ],
      },
      {
        type: "repeat",
        attrs: {
          list: "invoice.lines",
          display: "table",
          columns: [
            { field: "item", header: "Item" },
            { field: "amount", header: "Amount" },
          ],
          empty: "blank",
        },
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Total: " },
          { type: "variable", attrs: { path: "invoice.total" }, marks: [{ type: "bold" }] },
        ],
      },
      {
        type: "conditional",
        attrs: { expr: "not invoice.paid" },
        content: [
          {
            type: "paragraph",
            attrs: { variant: "note" },
            content: [{ type: "text", text: "Please pay within 30 days." }],
          },
        ],
      },
    ],
  },
});

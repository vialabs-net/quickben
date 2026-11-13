import { describe, expect, it } from "vitest";

import { escapeHtml, renderDocument } from "../src";
import { defaultBrand } from "../src/brand";
import { resolveKind } from "../src/kinds";
import { resolvePage } from "../src/serialize";
import { resolveFormat } from "../src/values";

import { doc, invoice, p, signature, text, v } from "./fixtures";

import type { BrandRender, TemplateNode } from "../src";

const kind = resolveKind(invoice);
const brand: BrandRender = { ...defaultBrand, logo: null, faces: [], stack: "sans-serif" };
const data = {
  customer: { name: "Ada <script>", type: "company" },
  invoice: {
    number: "7",
    total: 1250,
    paid: true,
    lines: [
      { item: "Design", amount: 1000 },
      { item: "Hosting", amount: null },
    ],
    currency: "EUR",
  },
};

function render(nodes: TemplateNode[], extra: Partial<Parameters<typeof renderDocument>[0]> = {}) {
  return renderDocument({
    kind,
    content: doc(...nodes),
    data,
    brand,
    format: resolveFormat(),
    page: resolvePage(),
    ...extra,
  });
}

const body = (nodes: TemplateNode[]) => /<body>(.*)<\/body>/s.exec(render(nodes).html)?.[1] ?? "";

describe("renderDocument body", () => {
  it("escapes text and data", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
    expect(body([p(text("<b>"), v("customer.name"))])).toBe(
      '<p>&lt;b&gt;<span class="var">Ada &lt;script&gt;</span></p>',
    );
  });

  it("prints marks, transforms, formats and unknown variables", () => {
    const bold = {
      type: "text",
      text: "B",
      marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "link" }],
    };
    expect(body([p(bold)])).toBe("<p><u><em><strong>B</strong></em></u></p>");
    expect(body([p(v("customer.type", { transform: "upper" }))])).toContain(">COMPANY<");
    expect(body([p(v("customer.type", { transform: "lower" }))])).toContain(">company<");
    expect(body([p(v("customer.email", { transform: "upper" }))])).toContain(
      '<span class="unknown">[customer.email]</span>',
    );
    expect(body([p(v("invoice.date", { transform: "upper" }))])).toContain("________________");
    expect(body([p(v("invoice.total"))])).toContain("1,250");
    expect(body([p(v("invoice.currency"))])).toContain("[EUR]");
    expect(body([p(v(""))])).toContain("[variable]");
    expect(body([p(v("brand.legalName"))])).toContain("________________");
  });

  it("prints blocks", () => {
    expect(
      body([{ type: "heading", attrs: { level: 2, textAlign: "center" }, content: [text("H")] }]),
    ).toBe('<h2 class="a-center">H</h2>');
    expect(body([{ type: "heading", attrs: { level: 9 }, content: [] }])).toBe("<h1></h1>");
    expect(body([{ type: "paragraph", attrs: { variant: "note", textAlign: "right" } }])).toBe(
      '<p class="note a-right"><br></p>',
    );
    expect(body([{ type: "blockquote", content: [p(text("q"))] }])).toBe(
      "<blockquote><p>q</p></blockquote>",
    );
    expect(
      body([{ type: "bulletList", content: [{ type: "listItem", content: [p(text("a"))] }, p()] }]),
    ).toBe("<ul><li><p>a</p></li></ul>");
    expect(body([{ type: "orderedList", attrs: { start: 3 }, content: [] }])).toBe(
      '<ol start="3"></ol>',
    );
    expect(body([{ type: "orderedList", attrs: { start: 1 }, content: [] }])).toBe("<ol></ol>");
    expect(body([{ type: "horizontalRule" }, { type: "pageBreak" }, { type: "unknown" }])).toBe(
      '<hr><div class="page-break"></div>',
    );
    expect(body([p(text("a"), { type: "hardBreak" }, { type: "image" })])).toBe("<p>a<br></p>");
  });

  it("evaluates conditions", () => {
    expect(
      body([{ type: "conditional", attrs: { expr: "invoice.paid" }, content: [p(text("paid"))] }]),
    ).toBe("<p>paid</p>");
    expect(
      body([{ type: "conditional", attrs: { expr: "not invoice.paid" }, content: [p(text("x"))] }]),
    ).toBe("");
    expect(body([{ type: "conditional", attrs: { expr: "((" }, content: [p(text("x"))] }])).toBe(
      "",
    );
    const option = body([
      {
        type: "checkOption",
        attrs: { expr: "customer.type == 'company'", textAlign: "left" },
        content: [text("Company")],
      },
    ]);
    expect(option).toContain('class="box checked"');
    expect(option).toContain('<p class="a-left">Company</p>');
    expect(
      body([{ type: "checkOption", attrs: { expr: "invoice.missing" }, content: [] }]),
    ).toContain('class="box"');
    expect(body([p({ type: "checkMark", attrs: { expr: "invoice.paid" } })])).toContain(
      "ibox checked",
    );
    expect(body([p({ type: "checkMark", attrs: {} })])).toContain('<span class="ibox"></span>');
  });

  it("prints repeated lists as tables or bullets", () => {
    const repeat = (attrs: Record<string, unknown>): TemplateNode => ({
      type: "repeat",
      attrs: {
        list: "invoice.lines",
        columns: [{ field: "item", header: "Item" }, { field: "amount" }, { header: "x" }, null],
        ...attrs,
      },
    });
    expect(body([repeat({})])).toBe(
      '<table class="repeat"><thead><tr><th>Item</th><th></th></tr></thead><tbody><tr><td>Design</td><td>1000</td></tr><tr><td>Hosting</td><td></td></tr></tbody></table>',
    );
    expect(body([repeat({ display: "bullets" })])).toBe(
      '<ul class="repeat"><li>Design, 1000</li><li>Hosting, </li></ul>',
    );
    expect(body([repeat({ list: "customer.name" })])).toBe(
      "<p><strong>________________</strong></p>",
    );
    expect(body([repeat({ list: "x", empty: "hide" })])).toBe("");
    expect(body([{ type: "repeat" }])).toBe("<p><strong>________________</strong></p>");
  });

  it("prints fixed tables and signatures", () => {
    const table = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 2, rowspan: 1 }, content: [p(text("H"))] },
            { type: "x" },
          ],
        },
        {
          type: "tableRow",
          content: [{ type: "tableCell", attrs: { colspan: 99, rowspan: 2 }, content: [p()] }],
        },
        p(),
      ],
    };
    expect(body([table])).toBe(
      '<table class="grid"><tbody><tr><th colspan="2"><p>H</p></th></tr><tr><td rowspan="2"><p><br></p></td></tr></tbody></table>',
    );
    expect(body([signature])).toBe(
      '<div class="signature"><div class="sig-line"></div><div class="sig-caption">Customer</div><div class="sig-lines"><span class="var">Ada &lt;script&gt;</span></div></div>',
    );
    expect(body([{ type: "signature", attrs: { caption: "  " } }])).toContain(">Signature<");
  });
});

describe("renderDocument pages", () => {
  it("builds the print body, letterhead and preview", () => {
    const rendered = render([p(text("Body"))], { reference: "INV <7>", title: "Invoice 7" });
    expect(rendered.title).toBe("Invoice 7");
    expect(rendered.author).toBeNull();
    expect(rendered.html).toContain("@page{size:612pt 792pt;margin:100pt 64pt 38pt 64pt;}");
    expect(rendered.html).toContain('<html lang="en">');
    expect(rendered.letterhead).toContain("INV &lt;7&gt;");
    expect(rendered.preview).toContain('<div class="body"><p>Body</p></div>');
    expect(render([]).title).toBe("Invoice");
  });

  it("prints the brand: logo, identity, footer, font and colors", () => {
    const full: BrandRender = {
      ...brand,
      displayName: "Acme",
      legalName: "Acme Inc.",
      taxId: "12-3",
      address: "Main St 1",
      contact: "hi@acme.test",
      footer: "Thanks",
      primaryColor: "#ff0000",
      accentColor: "bad",
      logo: "data:image/png;base64,AAAA",
      faces: [{ weight: 400, style: "normal", url: "data:font/woff2;base64,AAAA" }],
    };
    const rendered = render([p(v("brand.name"))], { brand: full });
    expect(rendered.html).toContain("Acme");
    expect(rendered.html).toContain(
      '@font-face{font-family:"Brand";font-weight:400;font-style:normal;src:url(data:font/woff2;base64,AAAA)',
    );
    expect(rendered.html).toContain('font-family:"Brand",sans-serif');
    expect(rendered.html).toContain("color:#ff0000");
    expect(rendered.letterhead).toContain(
      '<img class="logo" src="data:image/png;base64,AAAA" alt="">',
    );
    expect(rendered.letterhead).toContain(
      "<strong>Acme Inc.</strong><div>12-3 · Main St 1</div><div>hi@acme.test</div>",
    );
    expect(rendered.letterhead).toContain("1.5pt solid #ff0000");
    expect(rendered.letterhead).toContain('<div class="left">Thanks</div>');
    expect(rendered.author).toBe("Acme Inc.");

    const nameOnly = render([], { brand: { ...brand, displayName: "Solo" } });
    expect(nameOnly.letterhead).toContain('<div class="brandname">Solo</div>');
    expect(nameOnly.letterhead).not.toContain('class="who"');
  });

  it("uses the template's footer and a taller footer area", () => {
    const footer: TemplateNode = {
      type: "pageFooter",
      content: [text("Confidential "), v("invoice.number")],
    };
    const rendered = render([p(), footer], { page: resolvePage({ reserveBottom: 64 }) });
    expect(rendered.letterhead).toContain(
      '<div class="left">Confidential <span class="var">7</span></div>',
    );
    expect(rendered.html).toContain("120pt 64pt;}");
    expect(rendered.letterhead).toContain("bottom:64pt");
    expect(render([{ type: "pageFooter", content: [] }]).html).toContain("38pt 64pt;}");
  });
});

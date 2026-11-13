# @quickben/plugin-templates

Document templates for [Quickben](https://quickben.vialabs.net): brands, versioned templates per document kind, a safe condition language, HTML and PDF rendering, and a TipTap editor in the admin.

```sh
pnpm add @quickben/plugin-templates
```

```ts
import { defineConfig } from "@quickben/core";
import { defineTemplateKind, renderTemplate, templates } from "@quickben/plugin-templates";

const invoice = defineTemplateKind({
  kind: "invoice",
  label: "Invoice",
  catalog: [
    { path: "customer.name", label: "Customer", sample: "Ada Lovelace" },
    { path: "invoice.total", label: "Total", type: "number", sample: 1250 },
  ],
});

export default defineConfig({ db, collections: [], plugins: [templates({ kinds: [invoice] })] });

const { html, version } = await renderTemplate(qb, { kind: "invoice", data });
```

## What the plugin adds

| Addition                     | Details                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `brands`                     | Names, tax id, address, contact, footer, colors, font, custom woff2 font, logo. One per organization, or one in all. |
| `document-templates`         | One per kind.                                                                                                        |
| `document-template-versions` | Numbered versions: one draft and one published per template. Published versions never change.                        |
| Kinds                        | `defineTemplateKind({ kind, label, catalog, baseTemplate?, sampleData?, requireSignature? })`.                       |
| Rendering                    | `renderTemplate` (HTML), `renderPdf` (with a `PdfRenderer`), `renderDocument` (pure).                                |
| Versions                     | `saveDraft`, `publishTemplate`, `discardDraft`, `archiveTemplate`, `restoreVersion`, `validateTemplate`.             |

## Entry points

| Import                                  | Contents                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@quickben/plugin-templates`            | Plugin, kinds, rendering, versions, brand helpers.                                        |
| `@quickben/plugin-templates/chromium`   | `chromiumRenderer()`. Needs `playwright-core`, `pdf-lib` and `CHROMIUM_PATH`.             |
| `@quickben/plugin-templates/admin`      | `templatesAdmin(config)`: Templates, editor and Brand pages. Needs the `@tiptap/*` peers. |
| `@quickben/plugin-templates/styles.css` | Styles of the admin pages. Import after `@quickben/admin/styles.css`.                     |

With `@quickben/plugin-tenancy`, list `templates()` first and add `TEMPLATE_COLLECTIONS` to the tenancy scope.

Full guide: https://quickben.vialabs.net/plugins/templates

## License

Apache-2.0

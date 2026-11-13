import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Input,
  Select,
  Textarea,
} from "@quickben/admin/ui";
import { getQuickben, NotFoundError } from "@quickben/core";
import { getRequestContext } from "@quickben/next";

import { brandLimits, CUSTOM_FONT, defaultBrand, systemFonts } from "../brand";
import { resolveKind } from "../kinds";
import { BRANDS, getTemplatesPlugin } from "../options";
import { loadBrand, renderDocument, renderTemplate } from "../render";
import { getBrand, getTemplateKinds } from "../service";

import { saveBrandAction } from "./actions";
import { canManage, Feedback, Field, Heading, load, Notice } from "./shared";

import type { CustomFont } from "../brand";
import type { TemplateContent } from "../content";
import type { PageProps } from "@quickben/admin";
import type { DocumentData, Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

const sampleContent: TemplateContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Document title" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Documents use your colors, font, logo and footer. Issued by " },
        { type: "variable", attrs: { path: "brand.name" } },
        { type: "text", text: "." },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section heading" }] },
    { type: "paragraph", content: [{ type: "text", text: "Body text of the document." }] },
  ],
};

/** The letterhead with a sample document: the first kind's template, or a short sample. */
async function previewOf(qb: Quickben, ctx: RequestContext): Promise<string> {
  const [kind] = getTemplateKinds(qb);
  if (kind) {
    try {
      const rendered = await renderTemplate(
        qb,
        { kind: kind.kind, data: kind.sampleData, source: "draft", reference: "Preview" },
        ctx,
      );
      return rendered.preview;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  const templates = getTemplatesPlugin(qb);
  return renderDocument({
    kind: kind ?? resolveKind({ kind: "sample", label: "Sample", catalog: [] }),
    content: sampleContent,
    data: {},
    brand: await loadBrand(qb, ctx),
    format: templates.format,
    page: templates.page,
    reference: "Preview",
  }).preview;
}

const str = (doc: DocumentData | null, key: string): string => {
  const value = doc?.[key];
  return typeof value === "string" ? value : "";
};

function TextField({
  name,
  label,
  doc,
  disabled,
  max,
  hint,
}: Readonly<{
  name: string;
  label: string;
  doc: DocumentData | null;
  disabled: boolean;
  max: number;
  hint?: string;
}>) {
  const id = `qbt-brand-${name}`;
  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Input
        id={id}
        name={name}
        defaultValue={str(doc, name)}
        maxLength={max}
        disabled={disabled}
      />
    </Field>
  );
}

function BrandForm({
  doc,
  logo,
  fonts,
  canEdit,
  save,
}: Readonly<{
  doc: DocumentData | null;
  logo: string | null;
  fonts: { key: string; label: string }[];
  canEdit: boolean;
  save: (formData: FormData) => Promise<void>;
}>) {
  const disabled = !canEdit;
  const customFont = (doc?.customFont ?? null) as CustomFont | null;
  const font = str(doc, "font") || defaultBrand.font;
  return (
    <form action={save} className="qbt:space-y-5">
      <Card>
        <CardHeader title="Identity" description="Printed in the letterhead of every document." />
        <CardBody className="qbt:grid qbt:gap-4 qbt:sm:grid-cols-2">
          <TextField
            name="displayName"
            label="Display name"
            doc={doc}
            disabled={disabled}
            max={brandLimits.displayName}
            hint="Shown when there is no logo."
          />
          <TextField
            name="legalName"
            label="Legal name"
            doc={doc}
            disabled={disabled}
            max={brandLimits.legalName}
          />
          <TextField
            name="taxId"
            label="Tax id"
            doc={doc}
            disabled={disabled}
            max={brandLimits.taxId}
          />
          <TextField
            name="address"
            label="Address"
            doc={doc}
            disabled={disabled}
            max={brandLimits.address}
          />
          <TextField
            name="contact"
            label="Contact"
            doc={doc}
            disabled={disabled}
            max={brandLimits.contact}
            hint="Phone, email or website."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Look" />
        <CardBody className="qbt:grid qbt:gap-4 qbt:sm:grid-cols-3">
          <Field label="Primary color" htmlFor="qbt-brand-primary" hint="Headings and the name.">
            <Input
              id="qbt-brand-primary"
              name="primaryColor"
              type="color"
              defaultValue={str(doc, "primaryColor") || defaultBrand.primaryColor}
              disabled={disabled}
              className="qbt:p-1"
            />
          </Field>
          <Field label="Accent color" htmlFor="qbt-brand-accent" hint="The letterhead rule.">
            <Input
              id="qbt-brand-accent"
              name="accentColor"
              type="color"
              defaultValue={str(doc, "accentColor") || defaultBrand.accentColor}
              disabled={disabled}
              className="qbt:p-1"
            />
          </Field>
          <Field label="Font" htmlFor="qbt-brand-font">
            <Select id="qbt-brand-font" name="font" defaultValue={font} disabled={disabled}>
              {fonts.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
              {customFont ? <option value={CUSTOM_FONT}>{customFont.name}</option> : null}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Logo" description="PNG, JPEG or WebP, at most 512 KB." />
        <CardBody className="qbt:flex qbt:flex-wrap qbt:items-end qbt:gap-6">
          {logo ? (
            <img
              src={logo}
              alt="Current logo"
              className="qbt:max-h-12 qbt:max-w-48 qbt:object-contain"
            />
          ) : (
            <p className="qbt:text-sm qbt:text-zinc-500">No logo.</p>
          )}
          <Field label="Upload a logo" htmlFor="qbt-brand-logo">
            <Input
              id="qbt-brand-logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled}
              className="qbt:h-auto qbt:py-1.5"
            />
          </Field>
          {logo ? (
            <label className="qbt:flex qbt:items-center qbt:gap-2 qbt:text-sm">
              <Checkbox name="removeLogo" disabled={disabled} />
              Remove the logo
            </label>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Custom font"
          description="woff2 files, at most 512 KB each. Uploading one selects it."
        />
        <CardBody className="qbt:grid qbt:gap-4 qbt:sm:grid-cols-3">
          <Field label="Name" htmlFor="qbt-brand-font-name">
            <Input
              id="qbt-brand-font-name"
              name="fontName"
              defaultValue={customFont?.name ?? ""}
              maxLength={80}
              disabled={disabled}
            />
          </Field>
          <Field label="Regular (woff2)" htmlFor="qbt-brand-font-regular">
            <Input
              id="qbt-brand-font-regular"
              name="fontRegular"
              type="file"
              accept=".woff2,font/woff2"
              disabled={disabled}
              className="qbt:h-auto qbt:py-1.5"
            />
          </Field>
          <Field label="Bold (woff2, optional)" htmlFor="qbt-brand-font-bold">
            <Input
              id="qbt-brand-font-bold"
              name="fontBold"
              type="file"
              accept=".woff2,font/woff2"
              disabled={disabled}
              className="qbt:h-auto qbt:py-1.5"
            />
          </Field>
          {customFont ? (
            <label className="qbt:flex qbt:items-center qbt:gap-2 qbt:text-sm">
              <Checkbox name="removeFont" disabled={disabled} />
              Remove “{customFont.name}”
            </label>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Footer"
          description="Printed at the foot of every page. A template can set its own."
        />
        <CardBody>
          <Field label="Footer text" htmlFor="qbt-brand-footer">
            <Textarea
              id="qbt-brand-footer"
              name="footer"
              defaultValue={str(doc, "footer")}
              maxLength={brandLimits.footer}
              disabled={disabled}
            />
          </Field>
        </CardBody>
      </Card>

      {canEdit ? (
        <Button type="submit">Save brand</Button>
      ) : (
        <p className="qbt:text-sm qbt:text-zinc-500">Your role cannot change the brand.</p>
      )}
    </form>
  );
}

/** Build the Brand page: identity, colors, font, logo, footer and a letterhead preview. */
export function createBrandPage(config: QuickbenConfig, key: string) {
  const save = saveBrandAction.bind(null, key);
  return async function BrandPage({ searchParams }: Readonly<PageProps>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const loaded = await load(async () => ({
      doc: await getBrand(qb, ctx),
      logo: (await loadBrand(qb, ctx)).logo,
      canEdit: await canManage(qb, BRANDS, ctx),
      preview: await previewOf(qb, ctx),
    }));
    const templates = getTemplatesPlugin(qb);
    const fonts = [
      ...systemFonts.map((font) => ({ key: font.key, label: font.label })),
      ...templates.fonts.map((font) => ({ key: font.key, label: font.label })),
    ];
    return (
      <>
        <Heading
          title="Brand"
          description="The letterhead, colors and font of generated documents."
        />
        {loaded.value ? (
          <div className="qbt:grid qbt:gap-6 qbt:xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
            <BrandForm
              doc={loaded.value.doc}
              logo={loaded.value.logo}
              fonts={fonts}
              canEdit={loaded.value.canEdit}
              save={save}
            />
            <section
              aria-label="Preview"
              className="qbt:min-w-0 qbt:xl:sticky qbt:xl:top-6 qbt:xl:self-start"
            >
              <h2 className="qbt:mb-2 qbt:text-sm qbt:font-semibold qbt:text-zinc-900">Preview</h2>
              <iframe
                title="Brand preview"
                sandbox=""
                srcDoc={loaded.value.preview}
                className="qbt:h-[75vh] qbt:w-full qbt:rounded-lg qbt:border qbt:border-zinc-200 qbt:bg-zinc-200"
              />
            </section>
          </div>
        ) : (
          <Notice>{loaded.message}</Notice>
        )}
        <Feedback searchParams={searchParams} />
      </>
    );
  };
}

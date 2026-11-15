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
import { templatesMessages } from "./messages";
import { canManage, Feedback, Field, Heading, load, Notice } from "./shared";

import type { CustomFont } from "../brand";
import type { TemplateContent } from "../content";
import type { TemplatesT } from "./messages";
import type { PageProps } from "@quickben/admin";
import type { DocumentData, Quickben, QuickbenConfig, RequestContext } from "@quickben/core";

/** A short sample document in the admin's language. */
function sampleContent(t: TemplatesT): TemplateContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: t("sample.title") }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: t("sample.body") },
          { type: "variable", attrs: { path: "brand.name" } },
          { type: "text", text: "." },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: t("sample.section") }],
      },
      { type: "paragraph", content: [{ type: "text", text: t("sample.text") }] },
    ],
  };
}

/** The letterhead with a sample document: the first kind's template, or a short sample. */
async function previewOf(qb: Quickben, ctx: RequestContext, t: TemplatesT): Promise<string> {
  const [kind] = getTemplateKinds(qb);
  const reference = t("sample.reference");
  if (kind) {
    try {
      const rendered = await renderTemplate(
        qb,
        { kind: kind.kind, data: kind.sampleData, source: "draft", reference },
        ctx,
      );
      return rendered.preview;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  const templates = getTemplatesPlugin(qb);
  return renderDocument({
    kind: kind ?? resolveKind({ kind: "sample", label: t("sample.kind"), catalog: [] }),
    content: sampleContent(t),
    data: {},
    brand: await loadBrand(qb, ctx),
    format: templates.format,
    page: templates.page,
    reference,
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
  t,
}: Readonly<{
  doc: DocumentData | null;
  logo: string | null;
  fonts: { key: string; label: string }[];
  canEdit: boolean;
  save: (formData: FormData) => Promise<void>;
  t: TemplatesT;
}>) {
  const disabled = !canEdit;
  const customFont = (doc?.customFont ?? null) as CustomFont | null;
  const font = str(doc, "font") || defaultBrand.font;
  return (
    <form action={save} className="qbt:space-y-5">
      <Card>
        <CardHeader title={t("brand.identity")} description={t("brand.identityDescription")} />
        <CardBody className="qbt:grid qbt:gap-4 qbt:sm:grid-cols-2">
          <TextField
            name="displayName"
            label={t("brand.displayName")}
            doc={doc}
            disabled={disabled}
            max={brandLimits.displayName}
            hint={t("brand.displayNameHint")}
          />
          <TextField
            name="legalName"
            label={t("brand.legalName")}
            doc={doc}
            disabled={disabled}
            max={brandLimits.legalName}
          />
          <TextField
            name="taxId"
            label={t("brand.taxId")}
            doc={doc}
            disabled={disabled}
            max={brandLimits.taxId}
          />
          <TextField
            name="address"
            label={t("brand.address")}
            doc={doc}
            disabled={disabled}
            max={brandLimits.address}
          />
          <TextField
            name="contact"
            label={t("brand.contact")}
            doc={doc}
            disabled={disabled}
            max={brandLimits.contact}
            hint={t("brand.contactHint")}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("brand.look")} />
        <CardBody className="qbt:grid qbt:gap-4 qbt:sm:grid-cols-3">
          <Field
            label={t("brand.primaryColor")}
            htmlFor="qbt-brand-primary"
            hint={t("brand.primaryColorHint")}
          >
            <Input
              id="qbt-brand-primary"
              name="primaryColor"
              type="color"
              defaultValue={str(doc, "primaryColor") || defaultBrand.primaryColor}
              disabled={disabled}
              className="qbt:p-1"
            />
          </Field>
          <Field
            label={t("brand.accentColor")}
            htmlFor="qbt-brand-accent"
            hint={t("brand.accentColorHint")}
          >
            <Input
              id="qbt-brand-accent"
              name="accentColor"
              type="color"
              defaultValue={str(doc, "accentColor") || defaultBrand.accentColor}
              disabled={disabled}
              className="qbt:p-1"
            />
          </Field>
          <Field label={t("brand.font")} htmlFor="qbt-brand-font">
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
        <CardHeader title={t("brand.logo")} description={t("brand.logoDescription")} />
        <CardBody className="qbt:flex qbt:flex-wrap qbt:items-end qbt:gap-6">
          {logo ? (
            <img
              src={logo}
              alt={t("brand.currentLogo")}
              className="qbt:max-h-12 qbt:max-w-48 qbt:object-contain"
            />
          ) : (
            <p className="qbt:text-sm qbt:text-fg-muted">{t("brand.noLogo")}</p>
          )}
          <Field label={t("brand.uploadLogo")} htmlFor="qbt-brand-logo">
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
              {t("brand.removeLogo")}
            </label>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("brand.customFont")} description={t("brand.customFontDescription")} />
        <CardBody className="qbt:grid qbt:gap-4 qbt:sm:grid-cols-3">
          <Field label={t("brand.fontName")} htmlFor="qbt-brand-font-name">
            <Input
              id="qbt-brand-font-name"
              name="fontName"
              defaultValue={customFont?.name ?? ""}
              maxLength={80}
              disabled={disabled}
            />
          </Field>
          <Field label={t("brand.fontRegular")} htmlFor="qbt-brand-font-regular">
            <Input
              id="qbt-brand-font-regular"
              name="fontRegular"
              type="file"
              accept=".woff2,font/woff2"
              disabled={disabled}
              className="qbt:h-auto qbt:py-1.5"
            />
          </Field>
          <Field label={t("brand.fontBold")} htmlFor="qbt-brand-font-bold">
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
              {t("brand.removeFont", { name: customFont.name })}
            </label>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("brand.footer")} description={t("brand.footerDescription")} />
        <CardBody>
          <Field label={t("brand.footerText")} htmlFor="qbt-brand-footer">
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
        <Button type="submit">{t("brand.save")}</Button>
      ) : (
        <p className="qbt:text-sm qbt:text-fg-muted">{t("brand.readOnly")}</p>
      )}
    </form>
  );
}

/** Build the Brand page: identity, colors, font, logo, footer and a letterhead preview. */
export function createBrandPage(config: QuickbenConfig, key: string) {
  const save = saveBrandAction.bind(null, key);
  return async function BrandPage({ searchParams, i18n }: Readonly<PageProps>) {
    const { t } = i18n.scope(templatesMessages);
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const loaded = await load(async () => ({
      doc: await getBrand(qb, ctx),
      logo: (await loadBrand(qb, ctx)).logo,
      canEdit: await canManage(qb, BRANDS, ctx),
      preview: await previewOf(qb, ctx, t),
    }));
    const templates = getTemplatesPlugin(qb);
    const fonts = [
      ...systemFonts.map((font) => ({ key: font.key, label: t(`font.${font.key}`) })),
      ...templates.fonts.map((font) => ({ key: font.key, label: font.label })),
    ];
    return (
      <>
        <Heading title={t("brand.title")} description={t("brand.description")} />
        {loaded.value ? (
          <div className="qbt:grid qbt:gap-6 qbt:xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
            <BrandForm
              doc={loaded.value.doc}
              logo={loaded.value.logo}
              fonts={fonts}
              canEdit={loaded.value.canEdit}
              save={save}
              t={t}
            />
            <section
              aria-label={t("brand.preview")}
              className="qbt:min-w-0 qbt:xl:sticky qbt:xl:top-6 qbt:xl:self-start"
            >
              <h2 className="qbt:mb-2 qbt:text-sm qbt:font-semibold qbt:text-fg">
                {t("brand.preview")}
              </h2>
              <iframe
                title={t("brand.previewFrame")}
                sandbox=""
                srcDoc={loaded.value.preview}
                className="qbt:h-[75vh] qbt:w-full qbt:rounded-lg qbt:border qbt:border-line qbt:bg-surface-stronger"
              />
            </section>
          </div>
        ) : (
          <Notice>{t(`error.${loaded.code}`)}</Notice>
        )}
        <Feedback searchParams={searchParams} t={t} />
      </>
    );
  };
}

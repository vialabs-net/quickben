import { defineCollection, fields as f, ValidationError } from "@quickben/core";
import { z } from "zod";

import { brandLimits, checkFont, checkLogo, CUSTOM_FONT, defaultBrand, isHexColor } from "./brand";
import { asContent, contentHash } from "./content";
import { BRANDS, TEMPLATES, VERSIONS } from "./options";

import type { TemplateContent } from "./content";
import type { ResolvedTemplates, TemplatesAccessRule } from "./options";
import type { DocumentData, RequestContext } from "@quickben/core";

/* Calls of the plugin itself may do what API callers may not: publish and archive versions. */

const internalKey = Symbol.for("quickben.templates.internal");

/** A copy of `ctx` that the version guard rails trust. */
export function internal(ctx: RequestContext): RequestContext {
  return { ...ctx, [internalKey]: true } as RequestContext;
}

function isInternal(ctx: RequestContext): boolean {
  return (ctx as unknown as Record<symbol, unknown>)[internalKey] === true;
}

/** System context: no user, no access checks. */
export const system: RequestContext = { user: null, overrideAccess: true };

function invalid(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

/** Organization id of a document, when tenancy added the field. */
function scopeOf(data: DocumentData): string {
  return typeof data.organization === "string" ? data.organization : "global";
}

type Operation = "read" | "create" | "update" | "delete";

/** The plugin's access options as collection rules. Missing ones keep the core default. */
function definedRules(state: { templates: ResolvedTemplates }) {
  const { read, manage } = state.templates.access;
  const rules: Partial<Record<Operation, TemplatesAccessRule>> = {};
  if (read) rules.read = read;
  if (manage) {
    rules.create = manage;
    rules.update = manage;
    rules.delete = manage;
  }
  return rules;
}

/** Shared state of one `templates()` plugin. */
export interface TemplatesState {
  readonly templates: ResolvedTemplates;
}

const hex = (value: string) => isHexColor(value) || "Use a color like #1d4ed8";

const customFontSchema = z.object({
  name: z.string().trim().min(1).max(80),
  regular: z.string().min(1),
  bold: z.string().min(1).nullable().optional(),
});

/** Fields of the `brands` collection. */
export function brandFields(templates: ResolvedTemplates) {
  const text = (maxLength: number) => f.text({ maxLength });
  const fontOptions = templates.fontKeys as [string, ...string[]];
  return {
    displayName: text(brandLimits.displayName),
    legalName: text(brandLimits.legalName),
    taxId: text(brandLimits.taxId),
    address: text(brandLimits.address),
    contact: text(brandLimits.contact),
    footer: f.textarea({ maxLength: brandLimits.footer }),
    primaryColor: f.text({ required: true, default: defaultBrand.primaryColor, validate: hex }),
    accentColor: f.text({ required: true, default: defaultBrand.accentColor, validate: hex }),
    font: f.select({ options: fontOptions, required: true, default: defaultBrand.font }),
    customFont: f.json({
      schema: customFontSchema,
      validate: (value) => {
        for (const url of [value.regular, value.bold]) {
          if (typeof url !== "string") continue;
          const result = checkFont(url);
          if (result !== true) return result;
        }
        return true;
      },
    }),
    logo: f.text({ validate: checkLogo }),
    /** `<organization or "global">`. Keeps one brand per organization. */
    key: f.text({ unique: true, admin: { hidden: true, readOnly: true } }),
  };
}

/** The `brands` collection: one per organization, or one in all without tenancy. */
export function brandsCollection(state: TemplatesState) {
  return defineCollection({
    slug: BRANDS,
    labels: { singular: "Brand", plural: "Brands" },
    fields: brandFields(state.templates),
    access: definedRules(state),
    hooks: {
      beforeChange: [
        ({ data, original }) => {
          const next: DocumentData = { ...original, ...data };
          if (next.font === CUSTOM_FONT && !next.customFont) {
            invalid("font", "Upload a font first");
          }
          return { ...data, key: scopeOf(next) };
        },
      ],
    },
    admin: { useAsTitle: "displayName", hidden: true, group: "Documents" },
  });
}

/** The `document-templates` collection: one per kind (and organization). */
export function templatesCollection(state: TemplatesState) {
  return defineCollection({
    slug: TEMPLATES,
    labels: { singular: "Document template", plural: "Document templates" },
    fields: {
      kind: f.text({
        required: true,
        index: true,
        validate: (value) => state.templates.kinds.has(value) || `Unknown template kind "${value}"`,
      }),
      /** `<organization or "global">:<kind>`. Keeps one template per kind. */
      key: f.text({ unique: true, admin: { hidden: true, readOnly: true } }),
    },
    access: definedRules(state),
    hooks: {
      beforeChange: [
        ({ data, original }) => {
          if (original && data.kind !== undefined && data.kind !== original.kind) {
            invalid("kind", "The kind of a template cannot change");
          }
          const next: DocumentData = { ...original, ...data };
          return { ...data, key: `${scopeOf(next)}:${String(next.kind)}` };
        },
      ],
      afterDelete: [
        async ({ id, qb }) => {
          const versions = await qb.find(
            VERSIONS,
            { where: { template: { eq: id } }, limit: 1000 },
            system,
          );
          for (const version of versions.docs)
            await qb.delete(VERSIONS, version.id, internal(system));
        },
      ],
    },
    admin: { useAsTitle: "kind", hidden: true, group: "Documents" },
  });
}

/** Statuses of a version. */
export const VERSION_STATUSES = ["draft", "published", "archived"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

function slotOf(template: unknown, status: unknown): string | null {
  if (status === "draft" || status === "published") return `${String(template)}:${status}`;
  return null;
}

async function nextNumber(
  qb: {
    find: (slug: string, query: object, ctx: RequestContext) => Promise<{ docs: DocumentData[] }>;
  },
  template: string,
): Promise<number> {
  const last = await qb.find(
    VERSIONS,
    { where: { template: { eq: template } }, sort: "-number", limit: 1 },
    system,
  );
  const number = last.docs[0]?.number;
  return (typeof number === "number" ? number : 0) + 1;
}

const frozen = ["template", "kind", "number"] as const;

/** The `document-template-versions` collection, with the versioning guard rails. */
export function versionsCollection(state: TemplatesState) {
  return defineCollection({
    slug: VERSIONS,
    labels: { singular: "Template version", plural: "Template versions" },
    fields: {
      template: f.relation({ to: TEMPLATES, required: true, index: true }),
      /** Copied from the template. */
      kind: f.text({ index: true, admin: { readOnly: true } }),
      /** 1, 2, 3… per template. Set on create. */
      number: f.number({ integer: true, min: 1, admin: { readOnly: true } }),
      status: f.select({ options: VERSION_STATUSES, required: true, default: "draft" }),
      content: f.json({
        // Typed here; checked by `validate`, which reports the first problem.
        schema: z.custom<TemplateContent>(() => true),
        required: true,
        validate: (value) => {
          try {
            asContent(value);
            return true;
          } catch (error) {
            if (error instanceof ValidationError)
              return error.issues[0]?.message ?? "Invalid content";
            throw error;
          }
        },
      }),
      contentHash: f.text({ admin: { readOnly: true } }),
      createdBy: f.text({ admin: { readOnly: true } }),
      updatedBy: f.text({ admin: { readOnly: true } }),
      publishedAt: f.datetime({ admin: { readOnly: true } }),
      publishedBy: f.text({ admin: { readOnly: true } }),
      archivedAt: f.datetime({ admin: { readOnly: true } }),
      /** Number of the version a restored draft was copied from. */
      restoredFrom: f.number({ integer: true, admin: { readOnly: true } }),
      /** `<template>:draft` or `<template>:published`: one of each per template. */
      slot: f.text({ unique: true, admin: { hidden: true, readOnly: true } }),
    },
    access: definedRules(state),
    hooks: {
      beforeValidate: [
        ({ operation, data, original, ctx }) => {
          if (isInternal(ctx)) return data;
          if (operation === "create") {
            if (data.status !== undefined && data.status !== "draft") {
              invalid("status", "New versions start as drafts. Publish them with publishTemplate.");
            }
            return data;
          }
          if (original.status !== "draft") {
            invalid("status", "Published and archived versions cannot change");
          }
          if (data.status !== undefined && data.status !== "draft") {
            invalid("status", "Publish a draft with publishTemplate");
          }
          return data;
        },
      ],
      beforeChange: [
        async ({ operation, data, original, ctx, qb }) => {
          const user = ctx.user?.id ?? null;
          if (operation === "create") {
            const template = await qb.findById(TEMPLATES, data.template, {}, ctx);
            const content = asContent(data.content);
            return {
              ...data,
              kind: template.kind as string,
              number: await nextNumber(qb, template.id),
              contentHash: await contentHash(content),
              createdBy: data.createdBy ?? user,
              updatedBy: data.updatedBy ?? user,
              slot: slotOf(template.id, data.status),
            };
          }
          for (const key of frozen) {
            if (data[key] !== undefined && data[key] !== original[key]) {
              invalid(key, `The ${key} of a version cannot change`);
            }
          }
          const next: DocumentData = { ...original, ...data };
          const extra: DocumentData = { slot: slotOf(next.template, next.status) };
          if (data.content !== undefined) {
            extra.contentHash = await contentHash(asContent(data.content));
            extra.updatedBy = user ?? original.updatedBy;
          }
          return { ...data, ...extra };
        },
      ],
      beforeDelete: [
        ({ doc, ctx }) => {
          if (!isInternal(ctx) && doc.status !== "draft") {
            invalid("status", "Only drafts can be deleted");
          }
        },
      ],
    },
    admin: { useAsTitle: "number", hidden: true, group: "Documents" },
  });
}

export type BrandsCollection = ReturnType<typeof brandsCollection>;
export type TemplatesCollection = ReturnType<typeof templatesCollection>;
export type VersionsCollection = ReturnType<typeof versionsCollection>;

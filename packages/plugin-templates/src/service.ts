import { NotFoundError, ValidationError } from "@quickben/core";

import { internal } from "./collections";
import { asContent } from "./content";
import { BRANDS, getTemplatesPlugin, TEMPLATES, VERSIONS } from "./options";
import { validateContent } from "./validate";

import type { VersionStatus } from "./collections";
import type { TemplateContent, TemplateIssue } from "./content";
import type { ResolvedKind } from "./kinds";
import type { DocumentData, Quickben, RequestContext } from "@quickben/core";

/** Metadata of a template version. */
export interface VersionSummary {
  id: string;
  number: number;
  status: VersionStatus;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  archivedAt: string | null;
  restoredFrom: number | null;
}

/** A version with its content. */
export interface VersionDetail extends VersionSummary {
  content: TemplateContent;
}

/** A kind and the state of its template. */
export interface TemplateSummary {
  kind: string;
  label: string;
  description: string | null;
  templateId: string | null;
  draft: VersionSummary | null;
  published: VersionSummary | null;
  /** Number of versions, archived ones included. */
  versionCount: number;
  /** The kind has a base template to start from and to render when nothing is published. */
  hasBase: boolean;
}

/** A kind, its draft and published versions, and the history. */
export interface TemplateDetail extends Omit<
  TemplateSummary,
  "draft" | "published" | "versionCount"
> {
  draft: VersionDetail | null;
  published: VersionDetail | null;
  /** Newest first. */
  versions: VersionSummary[];
}

/** Publishing was refused: the content has issues. `issues` paths are `content.<path>`. */
export class TemplateIssuesError extends ValidationError {
  /** The issues, with node paths. */
  readonly templateIssues: readonly TemplateIssue[];

  constructor(issues: readonly TemplateIssue[]) {
    super(
      issues.map((issue) => ({
        path: ["content", ...issue.path].join("."),
        message: issue.message,
      })),
    );
    this.name = "TemplateIssuesError";
    this.templateIssues = issues;
  }
}

/** There is no draft to publish. */
export class NoDraftError extends NotFoundError {
  constructor() {
    super("There is no draft to publish");
    this.name = "NoDraftError";
  }
}

/** A registered kind. Throws `NotFoundError` for an unknown one. */
export function getTemplateKind(qb: Quickben, kind: string): ResolvedKind {
  const resolved = getTemplatesPlugin(qb).kinds.get(kind);
  if (!resolved) throw new NotFoundError(`Unknown template kind "${kind}"`);
  return resolved;
}

/** Registered kinds, in registration order. */
export function getTemplateKinds(qb: Quickben): ResolvedKind[] {
  return [...getTemplatesPlugin(qb).kinds.values()];
}

/** Issues of content for a kind. Throws `ValidationError` when it is not a document. */
export function validateTemplate(qb: Quickben, kind: string, content: unknown): TemplateIssue[] {
  return validateContent(asContent(content), getTemplateKind(qb, kind));
}

/* Lookups */

// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- recursive filter
interface Where {
  [key: string]: object | undefined;
}

/** The organization the context asks for, set by the caller or by tenancy. */
function organizationOf(ctx: RequestContext): string | undefined {
  const id = (ctx as { organizationId?: unknown }).organizationId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** Add `organization = ctx.organizationId` when tenancy added the field. */
function scoped(qb: Quickben, slug: string, ctx: RequestContext, where: Where): Where {
  const organization = organizationOf(ctx);
  const hasField = qb.collections[slug]?.fieldList.some((field) => field.name === "organization");
  return organization && hasField
    ? { and: [where, { organization: { eq: organization } }] }
    : where;
}

async function findOne(
  qb: Quickben,
  slug: string,
  where: Where,
  ctx: RequestContext,
): Promise<DocumentData | null> {
  const result = await qb.find(slug, { where: scoped(qb, slug, ctx, where), limit: 2 }, ctx);
  if (result.docs.length > 1) {
    throw new ValidationError([
      { path: "organization", message: "Several organizations match. Choose one organization." },
    ]);
  }
  return result.docs[0] ?? null;
}

function summary(doc: DocumentData): VersionSummary {
  const text = (key: string) => (typeof doc[key] === "string" ? doc[key] : null);
  return {
    id: doc.id as string,
    number: doc.number as number,
    status: doc.status as VersionStatus,
    contentHash: text("contentHash"),
    createdAt: doc.createdAt as string,
    updatedAt: doc.updatedAt as string,
    createdBy: text("createdBy"),
    updatedBy: text("updatedBy"),
    publishedAt: text("publishedAt"),
    publishedBy: text("publishedBy"),
    archivedAt: text("archivedAt"),
    restoredFrom: typeof doc.restoredFrom === "number" ? doc.restoredFrom : null,
  };
}

function detail(doc: DocumentData): VersionDetail {
  return { ...summary(doc), content: doc.content as TemplateContent };
}

function findTemplate(qb: Quickben, kind: string, ctx: RequestContext) {
  return findOne(qb, TEMPLATES, { kind: { eq: kind } }, ctx);
}

async function versionsOf(
  qb: Quickben,
  templateIds: string[],
  ctx: RequestContext,
  status?: VersionStatus[],
): Promise<DocumentData[]> {
  if (templateIds.length === 0) return [];
  const where: Where = { template: { in: templateIds } };
  const result = await qb.find(
    VERSIONS,
    { where: status ? { ...where, status: { in: status } } : where, sort: "-number", limit: 1000 },
    ctx,
  );
  return result.docs;
}

function base(kind: ResolvedKind) {
  return {
    kind: kind.kind,
    label: kind.label,
    description: kind.description,
    hasBase: kind.baseTemplate !== null,
  };
}

/** Every registered kind with the state of its template. */
export async function listTemplates(qb: Quickben, ctx: RequestContext): Promise<TemplateSummary[]> {
  const kinds = getTemplateKinds(qb);
  const result = await qb.find(
    TEMPLATES,
    { where: scoped(qb, TEMPLATES, ctx, { kind: { in: kinds.map((k) => k.kind) } }), limit: 1000 },
    ctx,
  );
  const versions = await versionsOf(
    qb,
    result.docs.map((doc) => doc.id),
    ctx,
  );
  return kinds.map((kind) => {
    const template = result.docs.find((doc) => doc.kind === kind.kind);
    const own = versions.filter((version) => version.template === template?.id);
    const find = (status: VersionStatus) => own.find((version) => version.status === status);
    const draft = find("draft");
    const published = find("published");
    return {
      ...base(kind),
      templateId: template?.id ?? null,
      draft: draft ? summary(draft) : null,
      published: published ? summary(published) : null,
      versionCount: own.length,
    };
  });
}

/** A kind's template: draft, published version and history. */
export async function getTemplate(
  qb: Quickben,
  kind: string,
  ctx: RequestContext,
): Promise<TemplateDetail> {
  const resolved = getTemplateKind(qb, kind);
  const template = await findTemplate(qb, kind, ctx);
  const versions = template ? await versionsOf(qb, [template.id as string], ctx) : [];
  const find = (status: VersionStatus) => versions.find((version) => version.status === status);
  const draft = find("draft");
  const published = find("published");
  return {
    ...base(resolved),
    templateId: (template?.id as string | undefined) ?? null,
    draft: draft ? detail(draft) : null,
    published: published ? detail(published) : null,
    versions: versions.map(summary),
  };
}

/** One version of a kind. Throws `NotFoundError`. */
export async function getVersion(
  qb: Quickben,
  kind: string,
  versionId: string,
  ctx: RequestContext,
): Promise<VersionDetail> {
  const version = await qb.findById(VERSIONS, versionId, {}, ctx);
  if (version.kind !== kind) throw new NotFoundError("Version not found");
  return detail(version);
}

/** The published version of a kind, or `null`. */
export async function getPublishedVersion(
  qb: Quickben,
  kind: string,
  ctx: RequestContext,
): Promise<VersionDetail | null> {
  getTemplateKind(qb, kind);
  const template = await findTemplate(qb, kind, ctx);
  if (!template) return null;
  const [published] = await versionsOf(qb, [template.id as string], ctx, ["published"]);
  return published ? detail(published) : null;
}

/* Changes */

async function ensureTemplate(qb: Quickben, kind: string, ctx: RequestContext): Promise<string> {
  const template = await findTemplate(qb, kind, ctx);
  if (template) return template.id as string;
  const organization = organizationOf(ctx);
  const hasField = qb.collections[TEMPLATES]?.fieldList.some((f) => f.name === "organization");
  const created = await qb.create(
    TEMPLATES,
    { kind, ...(organization && hasField ? { organization } : {}) },
    ctx,
  );
  return created.id;
}

async function writeDraft(
  qb: Quickben,
  kind: string,
  content: TemplateContent,
  ctx: RequestContext,
  restoredFrom: number | null,
): Promise<DocumentData> {
  const templateId = await ensureTemplate(qb, kind, ctx);
  const [draft] = await versionsOf(qb, [templateId], ctx, ["draft"]);
  const data: DocumentData = { content, ...(restoredFrom === null ? {} : { restoredFrom }) };
  if (draft) return qb.update(VERSIONS, draft.id as string, data, ctx);
  return qb.create(VERSIONS, { ...data, template: templateId, status: "draft" }, ctx);
}

/**
 * Save content as the kind's draft: update the draft, or create it with the next number.
 * Drafts may have issues; they are returned, and they block publishing.
 */
export async function saveDraft(
  qb: Quickben,
  kind: string,
  content: unknown,
  ctx: RequestContext,
  options: { restoredFrom?: number } = {},
): Promise<{ draft: VersionSummary; issues: TemplateIssue[] }> {
  const resolved = getTemplateKind(qb, kind);
  const doc = asContent(content);
  const draft = await qb.transaction((tx) =>
    writeDraft(tx, kind, doc, ctx, options.restoredFrom ?? null),
  );
  return { draft: summary(draft), issues: validateContent(doc, resolved) };
}

/** Delete the kind's draft. Returns `false` when there was none. */
export async function discardDraft(
  qb: Quickben,
  kind: string,
  ctx: RequestContext,
): Promise<boolean> {
  getTemplateKind(qb, kind);
  return qb.transaction(async (tx) => {
    const template = await findTemplate(tx, kind, ctx);
    if (!template) return false;
    const [draft] = await versionsOf(tx, [template.id as string], ctx, ["draft"]);
    if (!draft) return false;
    await tx.delete(VERSIONS, draft.id as string, ctx);
    return true;
  });
}

async function archiveCurrent(
  qb: Quickben,
  templateId: string,
  ctx: RequestContext,
): Promise<boolean> {
  const [published] = await versionsOf(qb, [templateId], ctx, ["published"]);
  if (!published) return false;
  await qb.update(
    VERSIONS,
    published.id as string,
    { status: "archived", archivedAt: new Date().toISOString() },
    internal(ctx),
  );
  return true;
}

/**
 * Publish the kind's draft (after saving `content` as the draft, when given). The previous
 * published version is archived. Throws {@link TemplateIssuesError} when the content has issues
 * and `NotFoundError` when there is no draft.
 */
export async function publishTemplate(
  qb: Quickben,
  kind: string,
  ctx: RequestContext,
  options: { content?: unknown } = {},
): Promise<TemplateDetail> {
  const resolved = getTemplateKind(qb, kind);
  const content = options.content === undefined ? null : asContent(options.content);
  if (content) {
    const issues = validateContent(content, resolved);
    if (issues.length > 0) throw new TemplateIssuesError(issues);
  }
  await qb.transaction(async (tx) => {
    if (content) await writeDraft(tx, kind, content, ctx, null);
    const template = await findTemplate(tx, kind, ctx);
    const [draft] = template ? await versionsOf(tx, [template.id as string], ctx, ["draft"]) : [];
    if (!template || !draft) throw new NoDraftError();
    const issues = validateContent(asContent(draft.content), resolved);
    if (issues.length > 0) throw new TemplateIssuesError(issues);
    await archiveCurrent(tx, template.id as string, ctx);
    await tx.update(
      VERSIONS,
      draft.id as string,
      {
        status: "published",
        publishedAt: new Date().toISOString(),
        publishedBy: ctx.user?.id ?? null,
      },
      internal(ctx),
    );
  });
  return getTemplate(qb, kind, ctx);
}

/**
 * Stop using the published version. Renders then use the base template, or fail when the kind
 * has none. Throws `NotFoundError` when nothing is published.
 */
export async function archiveTemplate(
  qb: Quickben,
  kind: string,
  ctx: RequestContext,
): Promise<TemplateDetail> {
  getTemplateKind(qb, kind);
  await qb.transaction(async (tx) => {
    const template = await findTemplate(tx, kind, ctx);
    const archived = template ? await archiveCurrent(tx, template.id as string, ctx) : false;
    if (!archived) throw new NotFoundError("There is no published version");
  });
  return getTemplate(qb, kind, ctx);
}

/** Copy a version into the draft, to edit and publish it again. */
export async function restoreVersion(
  qb: Quickben,
  kind: string,
  versionId: string,
  ctx: RequestContext,
): Promise<TemplateDetail> {
  const version = await getVersion(qb, kind, versionId, ctx);
  await saveDraft(qb, kind, version.content, ctx, { restoredFrom: version.number });
  return getTemplate(qb, kind, ctx);
}

/* Brand */

/** The brand document, or `null` when none is saved. */
export async function getBrand(qb: Quickben, ctx: RequestContext): Promise<DocumentData | null> {
  return findOne(qb, BRANDS, {}, ctx);
}

/** Create or update the brand. `data` holds the fields to change. */
export async function saveBrand(
  qb: Quickben,
  data: Record<string, unknown>,
  ctx: RequestContext,
): Promise<DocumentData> {
  return qb.transaction(async (tx) => {
    const current = await findOne(tx, BRANDS, {}, ctx);
    if (current) return tx.update(BRANDS, current.id as string, data, ctx);
    const organization = organizationOf(ctx);
    const hasField = tx.collections[BRANDS]?.fieldList.some((f) => f.name === "organization");
    return tx.create(
      BRANDS,
      { ...data, ...(organization && hasField ? { organization } : {}) },
      ctx,
    );
  });
}

import { NotFoundError, ValidationError } from "@quickben/core";
import { describe, expect, it } from "vitest";

import {
  archiveTemplate,
  discardDraft,
  getPublishedVersion,
  getTemplate,
  getTemplateKinds,
  getVersion,
  listTemplates,
  NoDraftError,
  publishTemplate,
  restoreVersion,
  saveDraft,
  TemplateIssuesError,
  TEMPLATES,
  validateTemplate,
  VERSIONS,
} from "../src";
import { internal } from "../src/collections";

import { alice, as, doc, p, setup, signature, system, text, v } from "./fixtures";

const ok = (word: string) => doc(p(text(word)), signature);
const ctx = as(alice);

describe("drafts and publishing", () => {
  it("lists every kind with its state", async () => {
    const qb = await setup();
    expect(getTemplateKinds(qb).map((k) => k.kind)).toEqual(["invoice", "letter"]);
    expect(await listTemplates(qb, ctx)).toMatchObject([
      {
        kind: "invoice",
        templateId: null,
        draft: null,
        published: null,
        versionCount: 0,
        hasBase: true,
      },
      { kind: "letter", hasBase: false, description: null },
    ]);
  });

  it("saves one draft per kind, numbered, and returns its issues", async () => {
    const qb = await setup();
    const first = await saveDraft(qb, "invoice", ok("one"), ctx);
    expect(first.draft).toMatchObject({
      number: 1,
      status: "draft",
      createdBy: "alice",
      updatedBy: "alice",
    });
    expect(first.issues).toEqual([]);
    const second = await saveDraft(qb, "invoice", doc(p(v("nope"))), ctx);
    expect(second.draft.id).toBe(first.draft.id);
    expect(second.draft.contentHash).not.toBe(first.draft.contentHash);
    expect(second.issues.map((i) => i.message)).toEqual([
      'Unknown variable "nope"',
      "Add a signature block",
    ]);
    const detail = await getTemplate(qb, "invoice", ctx);
    expect(detail.draft?.content).toEqual(doc(p(v("nope"))));
    expect(detail.published).toBeNull();
    expect(detail.versions).toHaveLength(1);
  });

  it("publishes the draft, archives the previous version and keeps numbers growing", async () => {
    const qb = await setup();
    await saveDraft(qb, "invoice", ok("one"), ctx);
    const one = await publishTemplate(qb, "invoice", ctx);
    expect(one.published).toMatchObject({ number: 1, publishedBy: "alice" });
    expect(one.draft).toBeNull();
    const two = await publishTemplate(qb, "invoice", ctx, { content: ok("two") });
    expect(two.published?.number).toBe(2);
    expect(two.versions.map((x) => [x.number, x.status])).toEqual([
      [2, "published"],
      [1, "archived"],
    ]);
    expect(two.versions[1]?.archivedAt).not.toBeNull();
    expect((await getPublishedVersion(qb, "invoice", ctx))?.content).toEqual(ok("two"));
    const [summary] = await listTemplates(qb, ctx);
    expect(summary).toMatchObject({ published: { number: 2 }, draft: null, versionCount: 2 });
  });

  it("refuses to publish content with issues or without a draft", async () => {
    const qb = await setup();
    await expect(publishTemplate(qb, "invoice", ctx)).rejects.toBeInstanceOf(NoDraftError);
    const refused = publishTemplate(qb, "invoice", ctx, { content: doc(p(v("nope"))) });
    await expect(refused).rejects.toBeInstanceOf(TemplateIssuesError);
    await expect(refused).rejects.toMatchObject({
      issues: [
        { path: "content.0.0", message: 'Unknown variable "nope"' },
        { path: "content", message: "Add a signature block" },
      ],
    });
    await saveDraft(qb, "invoice", doc(p()), ctx);
    await expect(publishTemplate(qb, "invoice", ctx)).rejects.toBeInstanceOf(TemplateIssuesError);
    expect((await getTemplate(qb, "invoice", ctx)).published).toBeNull();
  });

  it("discards drafts, archives and restores versions", async () => {
    const qb = await setup();
    expect(await discardDraft(qb, "invoice", ctx)).toBe(false);
    await publishTemplate(qb, "invoice", ctx, { content: ok("one") });
    expect(await discardDraft(qb, "invoice", ctx)).toBe(false);
    await saveDraft(qb, "invoice", ok("draft"), ctx);
    expect(await discardDraft(qb, "invoice", ctx)).toBe(true);

    const archived = await archiveTemplate(qb, "invoice", ctx);
    expect(archived.published).toBeNull();
    await expect(archiveTemplate(qb, "invoice", ctx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveTemplate(qb, "letter", ctx)).rejects.toBeInstanceOf(NotFoundError);

    const [old] = archived.versions;
    const restored = await restoreVersion(qb, "invoice", old?.id ?? "", ctx);
    // The discarded draft (v2) left no trace, so its number is used again.
    expect(restored.draft).toMatchObject({ number: 2, restoredFrom: 1, content: ok("one") });
    await expect(getVersion(qb, "letter", old?.id ?? "", ctx)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("validates content and kinds", async () => {
    const qb = await setup();
    expect(validateTemplate(qb, "invoice", ok("x"))).toEqual([]);
    expect(() => validateTemplate(qb, "invoice", "<p>")).toThrow(ValidationError);
    expect(() => validateTemplate(qb, "nope", ok("x"))).toThrow(NotFoundError);
    await expect(saveDraft(qb, "invoice", { type: "doc" }, ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await getPublishedVersion(qb, "letter", ctx)).toBeNull();
  });
});

describe("guard rails on the collections", () => {
  it("never changes published or archived versions", async () => {
    const qb = await setup();
    const detail = await publishTemplate(qb, "invoice", ctx, { content: ok("one") });
    const id = detail.published?.id ?? "";
    await expect(qb.update(VERSIONS, id, { content: ok("hack") }, ctx)).rejects.toThrow(
      "cannot change",
    );
    await expect(qb.update(VERSIONS, id, { status: "archived" }, ctx)).rejects.toThrow(
      "cannot change",
    );
    await expect(qb.delete(VERSIONS, id, ctx)).rejects.toThrow("Only drafts");
    await expect(qb.update(VERSIONS, id, { content: ok("hack") }, system)).rejects.toThrow(
      "cannot change",
    );
  });

  it("creates drafts only and publishes through publishTemplate", async () => {
    const qb = await setup();
    const template = await qb.create(TEMPLATES, { kind: "invoice" }, ctx);
    await expect(
      qb.create(VERSIONS, { template: template.id, content: ok("x"), status: "published" }, ctx),
    ).rejects.toThrow("start as drafts");
    const draft = await qb.create(VERSIONS, { template: template.id, content: ok("x") }, ctx);
    expect(draft).toMatchObject({
      number: 1,
      kind: "invoice",
      status: "draft",
      slot: `${template.id}:draft`,
    });
    await expect(qb.update(VERSIONS, draft.id, { status: "published" }, ctx)).rejects.toThrow(
      "publishTemplate",
    );
    await expect(qb.update(VERSIONS, draft.id, { number: 9 }, ctx)).rejects.toThrow(
      "number of a version",
    );
    await expect(
      qb.update(VERSIONS, draft.id, { content: { type: "x" } as never }, ctx),
    ).rejects.toThrow("not a document");
    // A second draft of the same template is a conflict.
    await expect(
      qb.create(VERSIONS, { template: template.id, content: ok("y") }, ctx),
    ).rejects.toThrow();
    const moved = await qb.update(VERSIONS, draft.id, { status: "draft", restoredFrom: 1 }, ctx);
    expect(moved.updatedBy).toBe("alice");
    const published = await qb.update(VERSIONS, draft.id, { status: "published" }, internal(ctx));
    expect(published.slot).toBe(`${template.id}:published`);
  });

  it("keeps one template per kind and a fixed kind; deleting one deletes its versions", async () => {
    const qb = await setup();
    const template = await qb.create(TEMPLATES, { kind: "invoice" }, ctx);
    expect(template.key).toBe("global:invoice");
    await expect(qb.create(TEMPLATES, { kind: "invoice" }, ctx)).rejects.toThrow();
    await expect(qb.create(TEMPLATES, { kind: "nope" }, ctx)).rejects.toThrow(
      'Unknown template kind "nope"',
    );
    await expect(qb.update(TEMPLATES, template.id, { kind: "letter" }, ctx)).rejects.toThrow(
      "cannot change",
    );
    await publishTemplate(qb, "invoice", ctx, { content: ok("x") });
    await qb.delete(TEMPLATES, template.id, ctx);
    expect((await qb.find(VERSIONS, {}, system)).docs).toHaveLength(0);
  });
});

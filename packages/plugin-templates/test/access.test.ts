import {
  createQuickben,
  defineConfig,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { tenancy } from "@quickben/plugin-tenancy";
import { describe, expect, it } from "vitest";

import {
  BRANDS,
  getBrand,
  getTemplate,
  listTemplates,
  publishTemplate,
  renderTemplate,
  saveBrand,
  saveDraft,
  TEMPLATE_COLLECTIONS,
  templates,
} from "../src";

import { alice, as, doc, invoice, letter, p, setup, signature, system, text } from "./fixtures";

import type { QuickbenUser, RequestContext } from "@quickben/core";

const ok = (word: string) => doc(p(text(word)), signature);

describe("access options", () => {
  it("applies read and manage rules; anonymous users get nothing by default", async () => {
    const qb = await setup({
      access: {
        read: ({ user }) => user !== null,
        manage: ({ user }) => user?.roles?.includes("editor") === true,
      },
    });
    const editor = as({ id: "e", roles: ["editor"] });
    await saveDraft(qb, "invoice", ok("x"), editor);
    await expect(saveDraft(qb, "invoice", ok("y"), as(alice))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await getTemplate(qb, "invoice", as(alice))).draft).not.toBeNull();
    await expect(listTemplates(qb, as(null))).rejects.toBeInstanceOf(UnauthorizedError);

    const plain = await setup();
    await expect(saveDraft(plain, "invoice", ok("x"), as(null))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("registers a module", async () => {
    const qb = await setup({ module: { key: "documents", label: "Documents" } });
    expect(qb.config.modules).toEqual([
      { key: "documents", label: "Documents", collections: [...TEMPLATE_COLLECTIONS] },
    ]);
  });
});

describe("with tenancy", () => {
  async function tenants() {
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [
        templates({ kinds: [invoice, letter] }),
        tenancy({ scope: [...TEMPLATE_COLLECTIONS] }),
      ],
    });
    const qb = await createQuickben(config);
    const bob: QuickbenUser = { id: "bob", email: "bob@example.com" };
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
    const globex = await qb.create("organizations", { name: "Globex", slug: "globex" }, as(bob));
    const inOrg = (user: QuickbenUser, organizationId: string) =>
      ({ user, organizationId }) as RequestContext;
    return {
      qb,
      acme,
      globex,
      aliceCtx: inOrg(alice, acme.id),
      bobCtx: inOrg(bob, globex.id),
      bob,
    };
  }

  it("keeps templates and brands per organization", async () => {
    const { qb, acme, globex, aliceCtx, bobCtx } = await tenants();
    await publishTemplate(qb, "invoice", aliceCtx, { content: ok("acme") });
    await publishTemplate(qb, "invoice", bobCtx, { content: ok("globex") });
    await publishTemplate(qb, "invoice", bobCtx, { content: ok("globex 2") });
    expect((await getTemplate(qb, "invoice", aliceCtx)).published?.number).toBe(1);
    expect((await getTemplate(qb, "invoice", bobCtx)).published?.number).toBe(2);

    await saveBrand(qb, { displayName: "Acme Docs" }, aliceCtx);
    await saveBrand(qb, { displayName: "Acme Documents" }, aliceCtx);
    await saveBrand(qb, { displayName: "Globex Docs" }, bobCtx);
    expect((await getBrand(qb, aliceCtx))?.displayName).toBe("Acme Documents");
    expect((await qb.find(BRANDS, {}, system)).docs).toHaveLength(2);

    const forAcme = await renderTemplate(qb, { kind: "invoice", data: {}, organization: acme.id });
    expect(forAcme.html).toContain("<p>acme</p>");
    expect(forAcme.letterhead).toContain("Acme Documents");
    const forGlobex = await renderTemplate(qb, {
      kind: "invoice",
      data: {},
      organization: globex.id,
    });
    expect(forGlobex.html).toContain("<p>globex 2</p>");
    expect(forGlobex.version?.number).toBe(2);
  });

  it("asks for an organization when several match", async () => {
    const { qb, aliceCtx, bobCtx } = await tenants();
    await publishTemplate(qb, "invoice", aliceCtx, { content: ok("acme") });
    await publishTemplate(qb, "invoice", bobCtx, { content: ok("globex") });
    await expect(renderTemplate(qb, { kind: "invoice", data: {} })).rejects.toThrow(
      "Choose one organization",
    );
    await expect(
      renderTemplate(qb, { kind: "invoice", data: {}, organization: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not let one organization read another's templates", async () => {
    const { qb, globex, aliceCtx, bob } = await tenants();
    await publishTemplate(qb, "invoice", aliceCtx, { content: ok("acme") });
    const bobInGlobex = { user: bob, organizationId: globex.id } as RequestContext;
    expect((await getTemplate(qb, "invoice", bobInGlobex)).published).toBeNull();
  });
});

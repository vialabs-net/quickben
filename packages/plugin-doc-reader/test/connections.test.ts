import { createQuickben, defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { connections } from "@quickben/plugin-connections";
import { describe, expect, it } from "vitest";

import { DOC_USAGE, docReader, getDocReader, inProcessRunner, readDocument } from "../src";
import { connectionModels } from "../src/connections";

import { alice, invoiceInput, invoiceReply, mockModel, PNG, system } from "./helpers";

const admin = { id: "ada", roles: ["admin"] };

describe("connectionModels", () => {
  it("reads with a model of a connection and bills its prices", async () => {
    const { model } = mockModel(
      invoiceReply({
        number: { value: "A1", confidence: 1 },
        issuedOn: { value: "2026-01-02", confidence: 1 },
      }),
      { input: 1_000_000, output: 0 },
    );
    const runner = inProcessRunner();
    const config = defineConfig({
      db: memoryAdapter(),
      collections: [],
      plugins: [
        connections({ masterKey: "a".repeat(64) }),
        docReader({
          runner,
          types: [invoiceInput],
          rasterize: (bytes, mime) => Promise.resolve([{ page: 1, bytes, mime }]),
          log: () => undefined,
          ...connectionModels({ maxPages: 2, factories: { anthropic: () => model } }),
        }),
      ],
    });
    const qb = await createQuickben(config);
    const key = await qb.create(
      "credentials",
      { name: "Key", secret: "sk-test-0123456789abcdef" },
      { user: admin },
    );
    const connection = await qb.create(
      "connections",
      {
        name: "Claude",
        providerType: "anthropic",
        credential: key.id,
        metadata: {
          models: [
            {
              id: "vision-a",
              label: "Vision A",
              vision: true,
              default: true,
              inputPerMTokUsd: 3,
              outputPerMTokUsd: 15,
            },
            { id: "text-only" },
          ],
        },
      },
      { user: admin },
    );
    await qb.create(
      "connections",
      { name: "Blind", providerType: "anthropic", credential: key.id },
      { user: admin },
    );

    expect(await getDocReader(qb).listModels?.()).toEqual([
      {
        connectionId: connection.id,
        connectionName: "Claude",
        models: [{ id: "vision-a", label: "Vision A" }],
      },
    ]);

    // The shipped invoice type points at "conn-1"; read with the real connection instead.
    const type = await qb.find("doc-types", { where: { key: { eq: "invoice" } } }, system);
    const definition = type.docs[0]?.definition as typeof invoiceInput;
    await qb.update(
      "doc-types",
      type.docs[0]?.id ?? "",
      {
        definition: {
          ...definition,
          pipeline: {
            steps: [{ extractor: "vision-llm", config: { connectionId: connection.id } }],
          },
        },
      },
      system,
    );
    const reading = await readDocument(
      qb,
      { type: "invoice", file: { bytes: PNG }, wait: 5000 },
      { user: alice },
    );
    expect(reading).toMatchObject({ status: "OK", costUsd: 3 });
    const usage = await qb.find(DOC_USAGE, {}, system);
    expect(usage.docs[0]).toMatchObject({
      model: "vision-a",
      connectionName: "Claude",
      costUsd: 3,
    });

    const { resolveModel } = connectionModels();
    await expect(resolveModel(connection.id, "missing", qb)).rejects.toThrow(/not in connection/u);
    expect((await resolveModel(connection.id, "text-only", qb)).model).toMatchObject({
      vision: false,
      maxPages: 4,
    });
  });
});

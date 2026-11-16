import { describe, expect, it } from "vitest";
import { z } from "zod";

import { jsonRowColumns, jsonSchemaRowColumns } from "../src";

describe("jsonRowColumns", () => {
  it("describes an array of objects with primitive properties", () => {
    const schema = z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          label: z.string().default("").meta({ title: "Name", description: "Shown to users" }),
          maxPages: z.number().int().min(1).optional(),
          inputPerMTokUsd: z.number().min(0).max(10_000).default(0),
          vision: z.boolean().default(false),
          tier: z.enum(["fast", "smart"]).nullable(),
        }),
      )
      .max(100);
    expect(jsonRowColumns(schema)).toEqual([
      {
        key: "id",
        label: "Id",
        description: null,
        required: true,
        type: "text",
        minLength: 1,
        maxLength: 200,
      },
      {
        key: "label",
        label: "Name",
        description: "Shown to users",
        required: false,
        default: "",
        type: "text",
      },
      {
        key: "maxPages",
        label: "Max pages",
        description: null,
        required: false,
        type: "number",
        integer: true,
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      },
      {
        key: "inputPerMTokUsd",
        label: "Input per mtok usd",
        description: null,
        required: false,
        default: 0,
        type: "number",
        integer: false,
        min: 0,
        max: 10_000,
      },
      {
        key: "vision",
        label: "Vision",
        description: null,
        required: false,
        default: false,
        type: "boolean",
      },
      {
        key: "tier",
        label: "Tier",
        description: null,
        required: false,
        type: "select",
        options: ["fast", "smart"],
      },
    ]);
  });

  it("accepts defaults and nullable lists", () => {
    const item = z.object({ id: z.string() });
    expect(jsonRowColumns(z.array(item).default([]))?.map((c) => c.key)).toEqual(["id"]);
    expect(jsonRowColumns(z.array(item).nullable())?.map((c) => c.key)).toEqual(["id"]);
  });

  it("does not require a value for nullable primitive columns", () => {
    const columns = jsonRowColumns(
      z.array(
        z.object({
          text: z.string().min(1).nullable(),
          number: z.number().nullable(),
          flag: z.boolean().nullable(),
        }),
      ),
    );
    expect(columns?.map((column) => column.required)).toEqual([false, false, false]);
  });

  it("returns null for other shapes", () => {
    expect(jsonRowColumns(z.object({ id: z.string() }))).toBeNull();
    expect(jsonRowColumns(z.array(z.string()))).toBeNull();
    expect(jsonRowColumns(z.array(z.object({})))).toBeNull();
    expect(jsonRowColumns(z.array(z.object({ tags: z.array(z.string()) })))).toBeNull();
    expect(jsonRowColumns(z.array(z.object({ meta: z.object({ a: z.string() }) })))).toBeNull();
    expect(jsonRowColumns(z.array(z.object({ x: z.enum(["a"]).or(z.literal(1)) })))).toBeNull();
    expect(jsonRowColumns(z.array(z.object({ x: z.string().or(z.number()) })))).toBeNull();
  });

  it("returns null when JSON Schema cannot describe the schema", () => {
    const broken = { _zod: {} } as unknown as z.ZodType;
    expect(jsonRowColumns(broken)).toBeNull();
  });

  it("reads plain JSON Schema", () => {
    expect(jsonSchemaRowColumns(null)).toBeNull();
    expect(jsonSchemaRowColumns({ type: "array" })).toBeNull();
    expect(jsonSchemaRowColumns({ type: "array", items: { type: "object" } })).toBeNull();
    expect(
      jsonSchemaRowColumns({
        type: ["array", "null"],
        items: { type: "object", properties: { n: { type: ["integer", "null"] }, bad: 1 } },
      }),
    ).toBeNull();
    expect(
      jsonSchemaRowColumns({
        type: ["array", "null"],
        items: { type: "object", properties: { n: { type: ["integer", "null"] } } },
      }),
    ).toEqual([
      { key: "n", label: "N", description: null, required: false, type: "number", integer: true },
    ]);
    expect(
      jsonSchemaRowColumns({
        anyOf: [{ type: "string" }, { type: "number" }],
      }),
    ).toBeNull();
  });
});

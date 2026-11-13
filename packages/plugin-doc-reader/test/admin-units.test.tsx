// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  QuickbenError,
  UnauthorizedError,
  ValidationError,
} from "@quickben/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioError } from "../src";
import { AutoRefresh } from "../src/admin/client";
import {
  describeIssue,
  errorCode,
  errorMessage,
  issuePath,
  toastMessage,
} from "../src/admin/feedback";
import {
  definitionFromForm,
  expectedFromForm,
  filesOf,
  paramsFromForm,
  variantFromForm,
} from "../src/admin/forms";
import { formatMs, formatUsd, formatWhen, Meter } from "../src/admin/shared";

import { invoice } from "./helpers";

afterEach(() => {
  cleanup();
});

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe("feedback", () => {
  it("maps errors to fixed codes", () => {
    expect(errorCode(new StudioError("not-tested", "x"))).toBe("not-tested");
    expect(errorCode(new ValidationError([{ path: "a", message: "b" }]))).toBe("invalid");
    expect(errorCode(new ConflictError("taken"))).toBe("conflict");
    expect(errorCode(new UnauthorizedError())).toBe("unauthorized");
    expect(errorCode(new ForbiddenError())).toBe("forbidden");
    expect(errorCode(new NotFoundError())).toBe("not-found");
    expect(errorCode(new QuickbenError("CONFIG", "x"))).toBe("failed");
    expect(toastMessage("published")).toBe("Version published");
    expect(toastMessage("toString")).toBeUndefined();
    expect(errorMessage(3)).toBeUndefined();
  });

  it("names invalid values without echoing input", () => {
    expect(issuePath(new ValidationError([{ path: "fields.1.key", message: "x" }]))).toBe(
      "fields.1.key",
    );
    expect(issuePath(new ValidationError([{ path: "<script>", message: "x" }]))).toBeUndefined();
    expect(issuePath(new Error("x"))).toBeUndefined();
    expect(describeIssue("fields.1.key")).toBe("Field 2 key");
    expect(describeIssue("pipeline.steps.0.config")).toBe("Step 1 config");
    expect(describeIssue("classification.text.0")).toBe("Text pattern 1");
    expect(describeIssue("a b")).toBeUndefined();
    expect(describeIssue("pipeline")).toBeUndefined();
    expect(describeIssue(undefined)).toBeUndefined();
  });
});

describe("forms", () => {
  it("builds a definition from the editor's form", () => {
    const data = form({
      label: " Invoice ",
      description: "An invoice",
      pages: "1, 2",
      instructions: "",
      threshold: "0.7",
      stopWhen: "all",
      classText: "INVOICE\n\n  BILL ",
      classFileName: "",
      fieldCount: "3",
      "fields.0.key": "number",
      "fields.0.label": "Number",
      "fields.0.type": "text",
      "fields.0.required": "on",
      "fields.0.transform": "compact",
      "fields.0.pattern": "^A",
      "fields.1.key": "gone",
      "fields.1.remove": "on",
      "fields.2.key": "issuedOn",
      "fields.2.dateOrder": "mdy",
      paramCount: "2",
      "params.0.key": "issuer",
      "params.0.type": "string-list",
      "params.0.excludes": "number, ",
      "params.0.description": "Issuer ids",
      "params.1.key": "",
      stepCount: "3",
      "steps.0.extractor": "vision-llm",
      "steps.0.order": "2",
      "steps.0.connectionId": "conn-1",
      "steps.0.model": "",
      "steps.0.maxPages": "2",
      "steps.0.config": '{"model":"old","extra":true}',
      "steps.1.extractor": "text-layer",
      "steps.1.order": "1",
      "steps.1.template": "invoice",
      "steps.2.extractor": "",
    });
    expect(definitionFromForm(data, invoice)).toEqual({
      label: "Invoice",
      description: "An invoice",
      pages: [1, 2],
      instructions: "",
      classification: { text: ["INVOICE", "BILL"], fileName: [] },
      fields: [
        {
          key: "number",
          label: "Number",
          type: "text",
          required: true,
          transform: "compact",
          pattern: "^A",
        },
        { key: "issuedOn", label: "issuedOn", type: "text", required: false, dateOrder: "mdy" },
      ],
      params: [
        {
          key: "issuer",
          label: "issuer",
          type: "string-list",
          excludes: ["number"],
          description: "Issuer ids",
        },
      ],
      pipeline: {
        steps: [
          { extractor: "text-layer", config: { template: "invoice" } },
          { extractor: "vision-llm", config: { extra: true, connectionId: "conn-1", maxPages: 2 } },
        ],
        threshold: 0.7,
        stopWhen: "all",
      },
    });
    const empty = definitionFromForm(form({ pages: "x", threshold: "" }), invoice);
    expect(empty).toMatchObject({
      pages: "x",
      fields: [],
      pipeline: { steps: [], threshold: 0.8, stopWhen: "required" },
    });
    expect(() =>
      definitionFromForm(
        form({ stepCount: "1", "steps.0.extractor": "custom", "steps.0.config": "[1]" }),
        invoice,
      ),
    ).toThrow(ValidationError);
  });

  it("reads sample values, parameters, model choices and files", () => {
    const data = form({
      "expected.number": " A1 ",
      "expected.total": "",
      "params.issuerTaxIds": "1, 2",
    });
    expect(expectedFromForm(data, invoice)).toEqual({ number: "A1" });
    expect(paramsFromForm(data, invoice)).toEqual({ issuerTaxIds: ["1", "2"] });
    const single = {
      ...invoice,
      params: [{ key: "issuer", label: "Issuer", type: "string" as const, excludes: [] }],
    };
    expect(paramsFromForm(form({ "params.issuer": "x" }), single)).toEqual({ issuer: "x" });
    expect(variantFromForm(form({ "a.choice": "c|m" }), "a")).toEqual({
      connectionId: "c",
      model: "m",
    });
    expect(variantFromForm(form({ "a.choice": "c" }), "a")).toEqual({ connectionId: "c" });
    expect(variantFromForm(form({ "a.connectionId": "c", "a.model": "m" }), "a")).toEqual({
      connectionId: "c",
      model: "m",
    });
    expect(variantFromForm(form({ "a.connectionId": "c" }), "a")).toEqual({ connectionId: "c" });
    expect(variantFromForm(form({}), "a")).toBeUndefined();
    const files = new FormData();
    files.append("files", new File(["x"], "a.pdf"));
    files.append("files", new File([], ""));
    files.append("files", "text");
    expect(filesOf(files, "files").map((file) => file.name)).toEqual(["a.pdf"]);
  });
});

describe("shared bits", () => {
  it("formats money, durations and dates", () => {
    expect(formatUsd(0)).toBe("US$0.00");
    expect(formatUsd(0.0105)).toBe("US$0.0105");
    expect(formatUsd(12.5)).toBe("US$12.50");
    expect(formatMs(null)).toBe("—");
    expect(formatMs(120)).toBe("120 ms");
    expect(formatMs(1500)).toBe("1.5 s");
    expect(formatWhen(null)).toBe("—");
    expect(formatWhen("2026-11-13T10:22:33.000Z")).toBe("2026-11-13 10:22 UTC");
  });

  it("colors meters by budget use", () => {
    render(
      <>
        <Meter ratio={null} label="none" />
        <Meter ratio={0.5} label="half" />
        <Meter ratio={0.9} label="warn" />
        <Meter ratio={1.2} label="over" />
      </>,
    );
    expect(screen.getByText("No budget")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "over" }).getAttribute("aria-valuenow")).toBe("120");
  });

  it("refreshes while something runs", () => {
    vi.useFakeTimers();
    try {
      render(<AutoRefresh every={100} />);
      expect(screen.getByRole("status").textContent).toContain("Running");
      act(() => {
        vi.advanceTimersByTime(250);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("styles", () => {
  it("uses only utilities that @quickben/admin compiles", () => {
    const require = createRequire(import.meta.url);
    const css = readFileSync(
      join(dirname(require.resolve("@quickben/admin/package.json")), "dist/styles.css"),
      "utf8",
    );
    const dir = join(import.meta.dirname, "../src/admin");
    const used = new Set<string>();
    for (const file of readdirSync(dir)) {
      for (const match of readFileSync(join(dir, file), "utf8").matchAll(/qb:[\w:./[\]()%,-]+/gu))
        used.add(match[0]);
    }
    const escape = (name: string) => name.replaceAll(/[:./[\]()%,]/gu, (ch) => `\\${ch}`);
    const missing = [...used].filter((name) => !css.includes(`.${escape(name)}`));
    expect(missing).toEqual([]);
  });
});

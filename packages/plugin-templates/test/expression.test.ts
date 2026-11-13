import { describe, expect, it } from "vitest";

import { checkExpression, evaluate, ExpressionError, parseExpression, test } from "../src";
import { resolveKind } from "../src/kinds";

import { invoice } from "./fixtures";

const data = {
  customer: { type: "company", name: "Ada" },
  invoice: { paid: false, total: 1200, lines: [{ item: "x" }], empty: [], date: "2026-11-06" },
  flag: true,
  "flat.key": "yes",
};

describe("parseExpression and evaluate", () => {
  it("compares values", () => {
    expect(test("customer.type == 'company'", data)).toBe(true);
    expect(test('customer.type == "person"', data)).toBe(false);
    expect(test("customer.type != 'person'", data)).toBe(true);
    expect(test("invoice.total == '1200'", data)).toBe(true);
    expect(test("invoice.missing == null", data)).toBe(true);
    expect(test("invoice.lines == 'x'", data)).toBe(false);
    expect(test("customer == 'x'", data)).toBe(false);
    expect(test("flat.key == 'yes'", data)).toBe(true);
  });

  it("orders numbers, numeric strings and dates", () => {
    expect(test("invoice.total > 1000", data)).toBe(true);
    expect(test("invoice.total >= 1200 and invoice.total <= 1200", data)).toBe(true);
    expect(test("invoice.total < 5", data)).toBe(false);
    expect(test("'10' > '9'", data)).toBe(true);
    expect(test("invoice.date > '2026-01-01'", data)).toBe(true);
    expect(test("invoice.date < '2026-01-01'", data)).toBe(false);
    expect(test("'abc' <= 'abc'", data)).toBe(true);
    expect(test("'5' < 6", data)).toBe(true);
    expect(test("invoice.total < 'x'", data)).toBe(false);
    expect(test("'x' < 2", data)).toBe(false);
    expect(test("invoice.missing > 1", data)).toBe(false);
  });

  it("combines with and, or, not and parentheses", () => {
    expect(test("flag and invoice.lines", data)).toBe(true);
    expect(test("invoice.paid or invoice.empty", data)).toBe(false);
    expect(test("not invoice.paid && (flag || invoice.paid)", data)).toBe(true);
    expect(test("!flag", data)).toBe(false);
    expect(test("invoice.paid == false", data)).toBe(true);
    expect(test("true", data)).toBe(true);
  });

  it("reads an empty list and a missing value as false", () => {
    expect(test("invoice.empty", data)).toBe(false);
    expect(test("invoice.missing", data)).toBe(false);
  });

  it("rejects malformed conditions instead of running them", () => {
    expect(() => parseExpression("customer.type = 'x'")).toThrow("==");
    expect(() => parseExpression("(flag")).toThrow("parenthesis");
    expect(() => parseExpression("'abc")).toThrow("quotes");
    expect(() => parseExpression("flag flag")).toThrow('Unexpected "flag"');
    expect(() => parseExpression("flag )")).toThrow('Unexpected ")"');
    expect(() => parseExpression("process.exit()")).toThrow(ExpressionError);
    expect(() => parseExpression("a $ b")).toThrow('Unexpected "$"');
    expect(() => parseExpression("")).toThrow("Write a condition");
    expect(() => parseExpression("x".repeat(301))).toThrow("too long");
    expect(test('constructor.constructor("x")()', data)).toBe(false);
  });

  it("never reads properties outside the data", () => {
    expect(evaluate(parseExpression("constructor"), data)).toBe(false);
    expect(evaluate(parseExpression("__proto__"), {})).toBe(false);
    expect(evaluate(parseExpression("customer.name.length"), data)).toBe(false);
  });
});

describe("checkExpression", () => {
  const { catalog } = resolveKind(invoice);

  it("accepts variables of the kind", () => {
    expect(checkExpression("customer.type == 'company'", catalog)).toEqual([]);
    expect(checkExpression("invoice.paid and invoice.lines", catalog)).toEqual([]);
    expect(
      checkExpression("invoice.total > 10 or not (invoice.date < '2026-01-01')", catalog),
    ).toEqual([]);
    expect(checkExpression("'company' == customer.type", catalog)).toEqual([]);
    expect(checkExpression("brand.name", catalog)).toEqual([]);
  });

  it("rejects unknown variables", () => {
    expect(checkExpression("customer.age", catalog)).toEqual(['Unknown variable "customer.age"']);
  });

  it("checks enum values and types", () => {
    expect(checkExpression("customer.type == 'other'", catalog)[0]).toContain(
      "'person', 'company'",
    );
    expect(checkExpression("invoice.paid == 'yes'", catalog)[0]).toContain("true or false");
    expect(checkExpression("invoice.paid > 1", catalog)[0]).toContain("true or false");
    expect(checkExpression("invoice.lines == 'x'", catalog)[0]).toContain("is a list");
    expect(checkExpression("customer.name > 'a'", catalog)[0]).toContain("use == or !=");
    expect(checkExpression("customer.name == invoice.number", catalog)).toEqual([]);
  });

  it("reports syntax errors", () => {
    expect(checkExpression("invoice.paid ==", catalog)).toEqual(["The condition is incomplete"]);
  });
});

// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Select } from "../src/ui";

afterEach(() => {
  cleanup();
});

const root = join(import.meta.dirname, "..");

/** The body of the top-level `@layer <name>{…}` block of minified CSS. */
function layer(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name}{`);
  if (start === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return "";
}

/** The declarations of the first rule whose selector is `selector`. */
function declarations(css: string, selector: string): string {
  const start = css.indexOf(`${selector}{`);
  if (start === -1) return "";
  return css.slice(start + selector.length + 1, css.indexOf("}", start));
}

describe("select base styles in the built CSS", () => {
  let base = "";

  beforeAll(() => {
    // The same command as the `build` script, to stdout.
    const css = execFileSync(
      join(root, "node_modules/.bin/tailwindcss"),
      ["-i", "src/styles.css", "--minify"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    base = layer(css, "base");
  }, 30_000);

  const single = `.qb-root :where(select:not([multiple],[size]:not([size="0"],[size="1"])))`;

  it("hide the native arrow and draw a chevron in the theme color, in the base layer", () => {
    const rule = declarations(base, single);
    expect(rule).toContain("appearance:none");
    expect(rule).toContain(
      "padding-inline:var(--qb-select-chevron-inset) var(--qb-select-chevron-space)",
    );
    expect(rule).toMatch(
      /background-image:linear-gradient\(to top right,.*var\(--qb-select-chevron\)/,
    );
    expect(rule).toContain("background-repeat:no-repeat");
    expect(rule).toContain("var(--_qb-select-side,right)");
  });

  it("put the chevron at the start edge in right-to-left text", () => {
    const rule = declarations(
      base,
      `.qb-root :where(select:not([multiple],[size]:not([size="0"],[size="1"])):dir(rtl))`,
    );
    expect(rule).toContain("background-position:var(--_qb-select-side,left)");
    expect(declarations(base, ":where([dir=rtl])")).toContain("--_qb-select-side:left");
    expect(declarations(base, ":where([dir=ltr])")).toContain("--_qb-select-side:right");
  });

  it("restores the native arrow in forced colors", () => {
    const forced = base.slice(base.indexOf("@media (forced-colors:active)"));
    const rule = declarations(forced, single);
    expect(rule).toContain("appearance:auto");
    expect(rule).toContain("background-image:none");
  });

  it("define the select tokens on .qb-root", () => {
    for (const token of ["chevron", "chevron-inset", "chevron-space"]) {
      expect(base).toContain(`--qb-select-${token}:`);
    }
  });
});

describe("Select", () => {
  it("keeps the end padding of the base styles for the chevron", () => {
    render(
      <Select aria-label="Status">
        <option>Draft</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Status" });
    expect(select.className).toContain("qb:px-3");
    expect(select.className).toContain("qb:pe-(--qb-select-chevron-space)");
    expect(select.className).toContain("qb:border");
  });

  it("inline has no border or padding of its own and the chevron at its end edge", () => {
    render(
      <Select aria-label="Role" inline>
        <option>Owner</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select.className).not.toContain("qb:border");
    expect(select.className).not.toContain("qb:px-3");
    expect(select.className).toContain("qb:bg-transparent");
    expect(select.className).toContain("qb:[--qb-select-chevron-inset:0px]");
    expect(select.className).toContain("qb:[--qb-select-chevron-space:1.25rem]");
  });
});

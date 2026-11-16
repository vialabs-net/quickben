// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { themeStyle } from "../src";
import { createAdminContent } from "../src/page";
import { Badge, Button, Card } from "../src/ui";

import { editor, makeConfig } from "./fixtures";
import { actAs } from "./mocks";

import type { AdminTheme } from "../src";

afterEach(() => {
  cleanup();
});

const theme: AdminTheme = {
  fontSans: '"Inter", sans-serif',
  surfaceMuted: "#F6F9FC",
  headingText: "#0A3256",
  borderStrong: "#C3D4E3",
  accentHover: "#085084",
  selected: "#E0F0FE",
  successStrong: "#00875C",
  dangerStrong: "#9C1818",
  buttonRadius: "9999px",
  cardRadius: "16px",
  cardShadow: "0 3px 14px rgba(10,50,86,.08)",
};

const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8");

describe("theme tokens", () => {
  it("map each key to its custom property", () => {
    expect(themeStyle(theme)).toEqual({
      "--qb-font-sans": '"Inter", sans-serif',
      "--qb-surface-muted": "#F6F9FC",
      "--qb-heading-text": "#0A3256",
      "--qb-border-strong": "#C3D4E3",
      "--qb-accent-hover": "#085084",
      "--qb-selected": "#E0F0FE",
      "--qb-success-strong": "#00875C",
      "--qb-danger-strong": "#9C1818",
      "--qb-button-radius": "9999px",
      "--qb-card-radius": "16px",
      "--qb-card-shadow": "0 3px 14px rgba(10,50,86,.08)",
    });
  });

  it("set no style when nothing is set", () => {
    expect(themeStyle(undefined)).toBeUndefined();
    expect(themeStyle({})).toBeUndefined();
    expect(themeStyle({ accent: "" })).toBeUndefined();
  });

  it("all have a default in styles.css", () => {
    const all: Required<AdminTheme> = {
      fontSans: "x",
      fontMono: "x",
      surface: "x",
      surfaceMuted: "x",
      text: "x",
      textMuted: "x",
      headingText: "x",
      border: "x",
      borderStrong: "x",
      accent: "x",
      accentHover: "x",
      accentText: "x",
      selected: "x",
      danger: "x",
      dangerStrong: "x",
      dangerText: "x",
      success: "x",
      successStrong: "x",
      warning: "x",
      info: "x",
      focusRing: "x",
      radius: "x",
      buttonRadius: "x",
      cardRadius: "x",
      cardPadding: "x",
      cardShadow: "x",
      titleSize: "x",
      titleWeight: "x",
      headingSize: "x",
      headingWeight: "x",
      tableRowHeight: "x",
    };
    const properties = Object.keys(themeStyle(all) ?? {});
    expect(properties).toHaveLength(Object.keys(all).length);
    for (const property of properties) expect(css).toContain(`    ${property}:`);
  });

  it("are read by the components", () => {
    render(
      <>
        <Button>Save</Button>
        <Card>Body</Card>
        <Badge tone="green">Done</Badge>
      </>,
    );
    expect(screen.getByRole("button", { name: "Save" }).className).toContain(
      "qb:rounded-(--qb-button-radius)",
    );
    expect(screen.getByText("Body").className).toContain("qb:shadow-(--qb-card-shadow)");
    expect(screen.getByText("Done").className).toContain("qb:text-success-strong");
  });
});

describe("theme and logo options", () => {
  const config = makeConfig();
  const props = { params: Promise.resolve({ segments: [] }), searchParams: Promise.resolve({}) };

  it("set the tokens on .qb-root and show the logo before the title", async () => {
    actAs(editor);
    const Page = createAdminContent(config, {
      theme,
      logo: <img src="/logo.svg" alt="" width={24} height={24} />,
    });
    const view = render(await Page(props));
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toContain("qb-root");
    expect(root.style.getPropertyValue("--qb-card-radius")).toBe("16px");
    expect(root.style.getPropertyValue("--qb-selected")).toBe("#E0F0FE");
    const home = screen.getByRole("link", { name: "Test admin" });
    expect(home.querySelector('img[src="/logo.svg"]')).toBeTruthy();
  });

  it("set the tokens in embedded mode too", async () => {
    actAs(editor);
    const Page = createAdminContent(config, { theme, chrome: "none" });
    const view = render(await Page(props));
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--qb-button-radius")).toBe("9999px");
  });

  it("leave the default look without a theme", async () => {
    actAs(editor);
    const Page = createAdminContent(config);
    const view = render(await Page(props));
    expect(view.container.firstElementChild?.hasAttribute("style")).toBe(false);
    expect(screen.getByRole("link", { name: "Test admin" }).querySelector("img")).toBeNull();
  });
});

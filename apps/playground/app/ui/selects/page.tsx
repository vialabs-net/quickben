import "@quickben/admin/styles.css";
import "./selects.css";

import { Label, Select } from "@quickben/admin/ui";

import type { CSSProperties, ReactNode } from "react";

export const metadata = { title: "Selects · Quickben Playground" };

const wide: CSSProperties = { width: "16rem" };
const field: CSSProperties = { display: "grid", gap: "0.375rem" };
const raw: CSSProperties = {
  border: "1px solid var(--qb-border-strong)",
  borderRadius: "var(--qb-radius)",
  paddingBlock: "0.25rem",
  justifySelf: "start",
  backgroundColor: "var(--qb-surface)",
};
/* A smaller Select: padding and chevron inset 0.5rem, as in the templates editor. */
const small = {
  width: "12rem",
  height: "1.75rem",
  paddingBlock: 0,
  paddingInlineStart: "0.5rem",
  fontSize: "0.75rem",
  "--qb-select-chevron-inset": "0.5rem",
  "--qb-select-chevron-space": "1.625rem",
} as CSSProperties;
const pill: CSSProperties = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: "0.375rem",
  border: "1px solid var(--qb-border-strong)",
  borderRadius: "9999px",
  backgroundColor: "var(--qb-surface)",
  padding: "0.25rem 0.75rem",
  fontSize: "0.875rem",
};

const options = ["Draft", "In review", "Published with a longer label"];

function Options() {
  return options.map((option) => <option key={option}>{option}</option>);
}

/** The cases of the base select styles, in one color scheme. */
function Panel({ scheme }: Readonly<{ scheme: "light" | "dark" }>) {
  const id = (name: string) => `${scheme}-${name}`;
  return (
    <section
      className="qb-root selects-panel"
      data-scheme={scheme}
      data-testid={`selects-${scheme}`}
    >
      <h2 className="qb-heading">{scheme === "light" ? "Light" : "Dark"}</h2>
      <Field label="Default" id={id("default")}>
        <Select id={id("default")} style={wide}>
          <Options />
        </Select>
      </Field>
      <Field label="Disabled" id={id("disabled")}>
        <Select id={id("disabled")} style={wide} disabled>
          <Options />
        </Select>
      </Field>
      <Field label="Small (h-7, px-2, text-xs)" id={id("small")}>
        <Select id={id("small")} style={small}>
          <Options />
        </Select>
      </Field>
      <Field label="Raw <select>, no Select component" id={id("raw")}>
        <select id={id("raw")} style={raw}>
          <Options />
        </select>
      </Field>
      <div style={field}>
        <span className="qb:text-sm qb:font-medium qb:text-fg">Inside a pill</span>
        <span data-testid={`pill-${scheme}`} style={pill}>
          <span style={{ color: "var(--qb-text-muted)" }}>Status</span>
          <Select inline aria-label="Status">
            <Options />
          </Select>
        </span>
      </div>
      <Field label="Right to left" id={id("rtl")}>
        <Select id={id("rtl")} dir="rtl" style={wide}>
          <option>مسودة</option>
          <option>منشور</option>
        </Select>
      </Field>
      <Field label="multiple (native)" id={id("multiple")}>
        <select id={id("multiple")} multiple style={{ ...raw, ...wide }}>
          <Options />
        </select>
      </Field>
    </section>
  );
}

function Field({
  label,
  id,
  children,
}: Readonly<{ label: string; id: string; children: ReactNode }>) {
  return (
    <div style={field}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Visual check of the select base styles: `/ui/selects`. */
export default function SelectsPage() {
  return (
    <main style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      <Panel scheme="light" />
      <Panel scheme="dark" />
    </main>
  );
}

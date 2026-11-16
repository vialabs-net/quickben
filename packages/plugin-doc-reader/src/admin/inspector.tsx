"use client";

import { useAdminI18n } from "@quickben/admin/i18n";
import { Badge, Button, Input, Table, Td, Textarea, Th, Tr } from "@quickben/admin/ui";
import { useState } from "react";

import { docReaderMessages } from "./messages";

import type { DocReaderT } from "./messages";
import type { ReactNode } from "react";

/** How a field came out, for the sample view. */
export type InspectStatus = "correct" | "wrong" | "missed" | "hallucinated" | "unchecked";

export interface InspectField {
  readonly key: string;
  readonly label: string;
  readonly scored: boolean;
  readonly expected: string | null;
  readonly read: string | null;
  readonly confidence: number | null;
  readonly status: InspectStatus;
  /** Read below the type's threshold. */
  readonly low: boolean;
  readonly evidence: {
    readonly page: number;
    readonly text: string;
    readonly box?: {
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    };
    readonly source?: "text-layer" | "model";
  } | null;
  readonly step: { readonly index: number; readonly extractor: string } | null;
}

export interface InspectPage {
  readonly page: number;
  /** A data URL of the rendered page. */
  readonly src: string;
}

type Filter = "all" | "errors" | "low" | "correct";
const FILTERS: readonly Filter[] = ["all", "errors", "low", "correct"];

const isError = (field: InspectField) =>
  field.status === "wrong" || field.status === "missed" || field.status === "hallucinated";

export function matchesFilter(field: InspectField, filter: Filter): boolean {
  if (filter === "errors") return isError(field);
  if (filter === "low") return field.low;
  if (filter === "correct") return field.status === "correct";
  return true;
}

const pct = (n: number) => `${String(Math.round(n * 10_000) / 100)}%`;

function color(field: InspectField): string {
  if (field.status === "correct") return "var(--qb-success)";
  if (isError(field)) return "var(--qb-danger)";
  return "var(--qb-info)";
}

const tones: Record<InspectStatus, "green" | "red" | "amber" | "neutral"> = {
  correct: "green",
  wrong: "red",
  missed: "amber",
  hallucinated: "red",
  unchecked: "neutral",
};

function StatusBadges({ field, t }: Readonly<{ field: InspectField; t: DocReaderT }>) {
  return (
    <span className="qb:flex qb:flex-wrap qb:gap-1">
      <Badge tone={tones[field.status]}>{t(`inspect.status.${field.status}`)}</Badge>
      {field.low ? <Badge tone="amber">{t("inspect.status.low")}</Badge> : null}
      {field.scored ? null : <Badge tone="neutral">{t("metrics.unscored")}</Badge>}
    </span>
  );
}

function PageView({
  page,
  fields,
  selected,
  select,
  t,
}: Readonly<{
  page: InspectPage;
  fields: readonly InspectField[];
  selected: string | null;
  select: (key: string) => void;
  t: DocReaderT;
}>) {
  const boxed = fields.filter((f) => f.evidence?.page === page.page && f.evidence.box);
  return (
    <figure className="qb:space-y-2">
      <div className="qb:relative" style={{ width: "fit-content", maxWidth: "100%" }}>
        {/* A data URL: next/image cannot optimize it. */}
        <img
          src={page.src}
          alt={t("inspect.pageAlt", { page: page.page })}
          className="qb:block qb:rounded-md qb:ring-1 qb:ring-line"
          style={{ maxWidth: "100%" }}
        />
        {boxed.map((field) => {
          const box = field.evidence?.box;
          if (!box) return null;
          const active = field.key === selected;
          return (
            <button
              key={field.key}
              type="button"
              aria-pressed={active}
              data-confidence={field.low ? "low" : "ok"}
              aria-label={t("inspect.boxAria", { label: field.label, value: field.read ?? "" })}
              onClick={() => {
                select(field.key);
              }}
              className="qb:absolute qb:rounded"
              style={{
                left: pct(box.x0),
                top: pct(box.y0),
                width: pct(box.x1 - box.x0),
                height: pct(box.y1 - box.y0),
                outlineWidth: active ? "3px" : "2px",
                outlineStyle: field.low ? "dashed" : "solid",
                outlineColor: color(field),
                background: `color-mix(in oklab, ${color(field)} ${active ? "22%" : "10%"}, transparent)`,
                cursor: "pointer",
              }}
            >
              <span
                className="qb:absolute qb:text-xs qb:font-medium"
                style={{
                  left: 0,
                  bottom: "100%",
                  whiteSpace: "nowrap",
                  padding: "0 0.25rem",
                  color: "white",
                  background: color(field),
                  borderRadius: "0.25rem 0.25rem 0 0",
                }}
              >
                {field.label}
              </span>
            </button>
          );
        })}
      </div>
      <figcaption className="qb:text-xs qb:text-fg-muted">
        {t("inspect.page", { page: page.page })}
      </figcaption>
    </figure>
  );
}

type Action = (formData: FormData) => Promise<void>;

function Detail({
  field,
  hidden,
  correct,
  annotate,
  t,
}: Readonly<{
  field: InspectField;
  hidden: Readonly<Record<string, string>>;
  correct: Action;
  annotate: Action;
  t: DocReaderT;
}>) {
  const inputs = (
    <>
      {Object.entries({ ...hidden, field: field.key }).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
  const empty = "—";
  return (
    <section
      aria-label={t("inspect.detail", { label: field.label })}
      className="qb:space-y-3 qb:text-sm"
    >
      <h3 className="qb:font-semibold">{field.label}</h3>
      <StatusBadges field={field} t={t} />
      <dl className="qb:grid qb:grid-cols-1 qb:gap-2 qb:sm:grid-cols-2">
        <div>
          <dt className="qb:text-fg-muted">{t("inspect.expected")}</dt>
          <dd className="qb:font-mono">{field.expected ?? empty}</dd>
        </div>
        <div>
          <dt className="qb:text-fg-muted">{t("inspect.read")}</dt>
          <dd className="qb:font-mono">{field.read ?? empty}</dd>
        </div>
        <div>
          <dt className="qb:text-fg-muted">{t("inspect.evidence")}</dt>
          <dd>
            {field.evidence?.text === undefined || field.evidence.text === ""
              ? empty
              : field.evidence.text}
          </dd>
        </div>
        <div>
          <dt className="qb:text-fg-muted">{t("inspect.where")}</dt>
          <dd>
            {field.evidence
              ? t("inspect.onPage", {
                  page: field.evidence.page,
                  source: t(
                    field.evidence.box
                      ? `inspect.source.${field.evidence.source ?? "model"}`
                      : "inspect.source.none",
                  ),
                })
              : empty}
          </dd>
        </div>
        <div>
          <dt className="qb:text-fg-muted">{t("inspect.step")}</dt>
          <dd>
            {field.step
              ? t("inspect.stepValue", {
                  step: field.step.index + 1,
                  extractor: field.step.extractor,
                })
              : empty}
          </dd>
        </div>
        <div>
          <dt className="qb:text-fg-muted">{t("inspect.confidence")}</dt>
          <dd>{field.confidence === null ? empty : field.confidence.toFixed(2)}</dd>
        </div>
      </dl>
      <form action={correct} className="qb:flex qb:flex-wrap qb:items-end qb:gap-2">
        {inputs}
        <label className="qb:space-y-1">
          <span className="qb:block qb:text-fg-muted">{t("inspect.correctLabel")}</span>
          <Input name="value" defaultValue={field.read ?? field.expected ?? ""} />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("inspect.correct")}
        </Button>
      </form>
      <form action={annotate} className="qb:space-y-2">
        {inputs}
        <label className="qb:block qb:space-y-1">
          <span className="qb:block qb:text-fg-muted">{t("inspect.noteLabel")}</span>
          <Textarea name="note" rows={2} required />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("inspect.annotate")}
        </Button>
      </form>
    </section>
  );
}

/**
 * The sample view: the sample list, the document with a box per field, and the fields. A box
 * and its row select each other.
 */
export function SampleInspector({
  list,
  pages,
  fallback,
  fields,
  hidden,
  correct,
  annotate,
}: Readonly<{
  /** The first column, rendered on the server. */
  list: ReactNode;
  pages: readonly InspectPage[];
  /** Shown when the pages could not be rendered. */
  fallback: ReactNode;
  fields: readonly InspectField[];
  hidden: Readonly<Record<string, string>>;
  correct: Action;
  annotate: Action;
}>) {
  const t = useAdminI18n().scope(docReaderMessages).t;
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(
    fields.find((field) => isError(field))?.key ?? null,
  );
  const shown = fields.filter((field) => matchesFilter(field, filter));
  const current = fields.find((field) => field.key === selected);
  const count = (name: Filter) => fields.filter((field) => matchesFilter(field, name)).length;
  return (
    <div className="qb:space-y-3">
      <div role="group" aria-label={t("inspect.filter")} className="qb:flex qb:flex-wrap qb:gap-2">
        {FILTERS.map((name) => (
          <Button
            key={name}
            type="button"
            size="sm"
            variant={filter === name ? "primary" : "ghost"}
            aria-pressed={filter === name}
            onClick={() => {
              setFilter(name);
            }}
          >
            {t(`inspect.filter.${name}`, { count: count(name) })}
          </Button>
        ))}
      </div>
      <div className="qb:flex qb:flex-wrap qb:gap-4" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 13rem", minWidth: 0 }}>{list}</div>
        <div style={{ flex: "3 1 26rem", minWidth: 0 }} className="qb:space-y-4">
          {pages.length > 0
            ? pages.map((page) => (
                <PageView
                  key={page.page}
                  page={page}
                  fields={shown}
                  selected={selected}
                  select={setSelected}
                  t={t}
                />
              ))
            : fallback}
        </div>
        <div style={{ flex: "2 1 20rem", minWidth: 0 }} className="qb:space-y-4">
          <Table aria-label={t("inspect.fields")}>
            <thead>
              <tr>
                <Th>{t("metrics.field")}</Th>
                <Th>{t("inspect.state")}</Th>
                <Th>{t("inspect.read")}</Th>
                <Th>{t("inspect.confidence")}</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((field) => (
                <Tr key={field.key} aria-selected={field.key === selected}>
                  <Td>
                    <button
                      type="button"
                      className="qb:font-medium qb:text-info qb:hover:underline"
                      aria-pressed={field.key === selected}
                      onClick={() => {
                        setSelected(field.key);
                      }}
                    >
                      {field.label}
                    </button>
                  </Td>
                  <Td>
                    <StatusBadges field={field} t={t} />
                  </Td>
                  <Td className="qb:font-mono qb:text-sm">{field.read ?? "—"}</Td>
                  <Td>{field.confidence === null ? "—" : field.confidence.toFixed(2)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {current ? (
            <Detail
              key={`${hidden.sampleId ?? ""}:${hidden.back ?? ""}:${current.key}:${current.read ?? ""}`}
              field={current}
              hidden={hidden}
              correct={correct}
              annotate={annotate}
              t={t}
            />
          ) : (
            <p className="qb:text-sm qb:text-fg-muted">{t("inspect.pick")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

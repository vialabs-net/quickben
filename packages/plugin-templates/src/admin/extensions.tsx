"use client";

/**
 * The template editor's nodes. The JSON they produce is what `serialize.ts` renders and
 * `validate.ts` checks: keep node names and attributes in step with `content.ts`.
 */
import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { createContext, useContext } from "react";

import type { TemplateIssue } from "../content";
import type { CatalogVariable } from "../kinds";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ReactNodeViewProps } from "@tiptap/react";

/* What node views read: the catalog and whether editing is allowed. */

export interface EditorMeta {
  catalog: readonly CatalogVariable[];
  readOnly: boolean;
}

export const EditorMetaContext = createContext<EditorMeta>({ catalog: [], readOnly: true });
const useMeta = () => useContext(EditorMetaContext);

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const control =
  "qbt:h-7 qbt:rounded qbt:border qbt:border-zinc-300 qbt:bg-white qbt:px-2 qbt:text-xs qbt:text-zinc-900 qbt:disabled:bg-zinc-50";
const caption =
  "qbt:shrink-0 qbt:text-[11px] qbt:font-medium qbt:tracking-wide qbt:text-zinc-500 qbt:uppercase";

function ConditionInput({
  value,
  onChange,
  label,
}: Readonly<{ value: string; onChange: (value: string) => void; label: string }>) {
  const { readOnly } = useMeta();
  return (
    <label className="qbt:flex qbt:min-w-0 qbt:flex-1 qbt:items-center qbt:gap-2">
      <span className={caption}>{label}</span>
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        disabled={readOnly}
        spellCheck={false}
        placeholder="order.paid and total > 100"
        className={cx(control, "qbt:min-w-0 qbt:flex-1 qbt:font-mono")}
      />
    </label>
  );
}

const exprOf = (node: PMNode) => (typeof node.attrs.expr === "string" ? node.attrs.expr : "");

/* Variable: an inline chip. */

function VariableView({ node, updateAttributes, selected }: Readonly<ReactNodeViewProps>) {
  const { catalog, readOnly } = useMeta();
  const path = typeof node.attrs.path === "string" ? node.attrs.path : "";
  const def = catalog.find((v) => v.path === path);
  const transform = typeof node.attrs.transform === "string" ? node.attrs.transform : "";
  const suffix = { lower: " · lowercase", upper: " · UPPERCASE" }[transform] ?? "";
  return (
    <NodeViewWrapper as="span" className="qbt:relative">
      <span
        title={def ? `${def.label} · ${path}` : `Unknown variable: ${path}`}
        data-variable-chip={path}
        className={cx(
          "qbt-chip",
          def ? "qbt-chip-known" : "qbt-chip-unknown",
          selected && "qbt-chip-selected",
        )}
      >
        {(def?.label ?? path) + suffix}
      </span>
      {selected && !readOnly ? (
        <span contentEditable={false} className="qbt-popover">
          <select
            value={transform}
            onChange={(event) => {
              updateAttributes({ transform: event.target.value || null });
            }}
            aria-label="Letter case"
            className={control}
          >
            <option value="">As is</option>
            <option value="lower">lowercase</option>
            <option value="upper">UPPERCASE</option>
          </select>
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

export const Variable = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "_",
  addAttributes() {
    return { path: { default: "" }, transform: { default: null } };
  },
  parseHTML: () => [{ tag: "span[data-variable]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-variable": "" }),
  ],
  renderText: ({ node }) => `{${String(node.attrs.path)}}`,
  addNodeView: () => ReactNodeViewRenderer(VariableView),
});

/* Checkbox option: a box checked by a condition, then a line of text. */

function CheckOptionView({ node, updateAttributes }: Readonly<ReactNodeViewProps>) {
  return (
    <NodeViewWrapper className="qbt-block qbt-panel">
      <div contentEditable={false} className="qbt-panel-head">
        <ConditionInput
          label="Check if"
          value={exprOf(node)}
          onChange={(expr) => {
            updateAttributes({ expr });
          }}
        />
      </div>
      <div className="qbt:flex qbt:gap-3 qbt:px-3 qbt:py-2">
        <span contentEditable={false} aria-hidden="true" className="qbt-box" />
        <NodeViewContent className="qbt:min-w-0 qbt:flex-1" />
      </div>
    </NodeViewWrapper>
  );
}

export const CheckOption = Node.create({
  name: "checkOption",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return { expr: { default: "" } };
  },
  parseHTML: () => [{ tag: "div[data-check-option]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-check-option": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(CheckOptionView),
});

/* Inline checkbox inside a sentence. */

function CheckMarkView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: Readonly<ReactNodeViewProps>) {
  const { readOnly } = useMeta();
  const expr = exprOf(node);
  return (
    <NodeViewWrapper as="span" className="qbt:relative">
      <button
        type="button"
        onClick={(event) => {
          // The box is too small for ProseMirror's own click handling: select it here.
          const pos = getPos();
          if (typeof pos !== "number") return;
          event.preventDefault();
          editor.chain().focus().setNodeSelection(pos).run();
        }}
        aria-label={expr ? `Checked if: ${expr}` : "Checkbox without a condition"}
        title={expr ? `Checked if: ${expr}` : "Checkbox without a condition"}
        className={cx("qbt-ibox", !expr && "qbt-ibox-empty", selected && "qbt-chip-selected")}
      />
      {selected && !readOnly ? (
        <span contentEditable={false} className="qbt-popover qbt:w-80">
          <ConditionInput
            label="Check if"
            value={expr}
            onChange={(value) => {
              updateAttributes({ expr: value });
            }}
          />
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

export const CheckMark = Node.create({
  name: "checkMark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { expr: { default: "" } };
  },
  parseHTML: () => [{ tag: "span[data-check-mark]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-check-mark": "" }),
  ],
  renderText: () => "☐",
  addNodeView: () => ReactNodeViewRenderer(CheckMarkView),
});

/* Conditional block: printed only when its condition holds. */

function ConditionalView({ node, updateAttributes }: Readonly<ReactNodeViewProps>) {
  return (
    <NodeViewWrapper className="qbt-block qbt-panel qbt-conditional">
      <div contentEditable={false} className="qbt-panel-head">
        <ConditionInput
          label="Show if"
          value={exprOf(node)}
          onChange={(expr) => {
            updateAttributes({ expr });
          }}
        />
      </div>
      <NodeViewContent className="qbt:px-3 qbt:py-1" />
    </NodeViewWrapper>
  );
}

export const Conditional = Node.create({
  name: "conditional",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { expr: { default: "" } };
  },
  parseHTML: () => [{ tag: "div[data-conditional]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-conditional": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(ConditionalView),
});

/* Repeated list: a table or bullets, one row per item of a list variable. */

interface Column {
  field: string;
  header: string;
}

function RepeatColumns({
  list,
  columns,
  display,
  readOnly,
  update,
}: Readonly<{
  list: CatalogVariable | undefined;
  columns: Column[];
  display: string;
  readOnly: boolean;
  update: (columns: Column[]) => void;
}>) {
  const fields = list?.fields ?? [];
  const toggle = (key: string, label: string, on: boolean) => {
    const order = fields.map((f) => f.key);
    const next = on
      ? [...columns, { field: key, header: label }]
      : columns.filter((c) => c.field !== key);
    update(next.toSorted((a, b) => order.indexOf(a.field) - order.indexOf(b.field)));
  };
  return (
    <div className="qbt:flex qbt:flex-wrap qbt:gap-x-4 qbt:gap-y-2">
      {fields.map((field) => {
        const column = columns.find((c) => c.field === field.key);
        return (
          <span key={field.key} className="qbt:inline-flex qbt:items-center qbt:gap-1.5">
            <input
              type="checkbox"
              checked={Boolean(column)}
              disabled={readOnly}
              onChange={(event) => {
                toggle(field.key, field.label, event.target.checked);
              }}
              aria-label={`Column ${field.label}`}
            />
            {display === "table" && column ? (
              <input
                value={column.header}
                disabled={readOnly}
                onChange={(event) => {
                  update(
                    columns.map((c) =>
                      c.field === field.key ? { ...c, header: event.target.value } : c,
                    ),
                  );
                }}
                aria-label={`Header of ${field.label}`}
                className={cx(control, "qbt:w-32")}
              />
            ) : (
              <span className="qbt:text-zinc-700">{field.label}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function RepeatView({ node, updateAttributes, selected }: Readonly<ReactNodeViewProps>) {
  const { catalog, readOnly } = useMeta();
  const lists = catalog.filter((v) => v.type === "list");
  const path = typeof node.attrs.list === "string" ? node.attrs.list : "";
  const list = lists.find((v) => v.path === path);
  const columns = (Array.isArray(node.attrs.columns) ? node.attrs.columns : []) as Column[];
  const display = node.attrs.display === "bullets" ? "bullets" : "table";
  return (
    <NodeViewWrapper
      className={cx("qbt-block qbt-panel", selected && "qbt-selected")}
      data-drag-handle=""
    >
      <div contentEditable={false} className="qbt-panel-head qbt:flex-wrap qbt:text-xs">
        <span className={caption}>Repeated list</span>
        <select
          value={path}
          disabled={readOnly}
          onChange={(event) => {
            updateAttributes({ list: event.target.value, columns: [] });
          }}
          aria-label="List"
          className={control}
        >
          {list ? null : <option value={path}>{path || "Choose a list"}</option>}
          {lists.map((v) => (
            <option key={v.path} value={v.path}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={display}
          disabled={readOnly}
          onChange={(event) => {
            updateAttributes({ display: event.target.value });
          }}
          aria-label="Display"
          className={control}
        >
          <option value="table">as a table</option>
          <option value="bullets">as bullets</option>
        </select>
        <select
          value={node.attrs.empty === "hide" ? "hide" : "blank"}
          disabled={readOnly}
          onChange={(event) => {
            updateAttributes({ empty: event.target.value });
          }}
          aria-label="When empty"
          className={control}
        >
          <option value="blank">empty: blank line</option>
          <option value="hide">empty: hide</option>
        </select>
      </div>
      <div contentEditable={false} className="qbt:space-y-2 qbt:px-3 qbt:py-2 qbt:text-xs">
        <RepeatColumns
          list={list}
          columns={columns}
          display={display}
          readOnly={readOnly}
          update={(next) => {
            updateAttributes({ columns: next });
          }}
        />
      </div>
    </NodeViewWrapper>
  );
}

export const Repeat = Node.create({
  name: "repeat",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      list: { default: "" },
      display: { default: "table" },
      columns: { default: [] },
      empty: { default: "blank" },
    };
  },
  parseHTML: () => [{ tag: "div[data-repeat]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-repeat": "" }),
  ],
  addNodeView: () => ReactNodeViewRenderer(RepeatView),
});

/* Page break, signature and page footer. */

function PageBreakView({ selected }: Readonly<ReactNodeViewProps>) {
  return (
    <NodeViewWrapper
      contentEditable={false}
      className={cx("qbt-block qbt-page-break", selected && "qbt-selected")}
    >
      Page break
    </NodeViewWrapper>
  );
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-page-break": "" }),
  ],
  addNodeView: () => ReactNodeViewRenderer(PageBreakView),
});

function SignatureView({ node, updateAttributes }: Readonly<ReactNodeViewProps>) {
  const { readOnly } = useMeta();
  return (
    <NodeViewWrapper className="qbt-block qbt-signature">
      <div contentEditable={false} className="qbt-sig-line">
        <input
          value={typeof node.attrs.caption === "string" ? node.attrs.caption : ""}
          onChange={(event) => {
            updateAttributes({ caption: event.target.value });
          }}
          disabled={readOnly}
          maxLength={80}
          aria-label="Signature caption"
          className="qbt:w-full qbt:bg-transparent qbt:text-center qbt:font-semibold qbt:text-zinc-900"
        />
      </div>
      <NodeViewContent className="qbt-sig-lines" />
    </NodeViewWrapper>
  );
}

export const Signature = Node.create({
  name: "signature",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return { caption: { default: "Signature" } };
  },
  parseHTML: () => [{ tag: "div[data-signature]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-signature": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(SignatureView),
});

function PageFooterView() {
  return (
    <NodeViewWrapper className="qbt-block qbt-panel qbt-footer">
      <div contentEditable={false} className={cx("qbt-panel-head", caption)}>
        Page footer · printed on every page instead of the brand footer
      </div>
      <NodeViewContent className="qbt:px-3 qbt:py-1.5 qbt:text-xs qbt:text-zinc-600" />
    </NodeViewWrapper>
  );
}

export const PageFooter = Node.create({
  name: "pageFooter",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "div[data-page-footer]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-page-footer": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(PageFooterView),
});

/* Paragraph style: normal or note. */

export const ParagraphVariant = Extension.create({
  name: "paragraphVariant",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          variant: {
            default: null,
            parseHTML: (element) => (element.classList.contains("note") ? "note" : null),
            renderHTML: (attributes) => (attributes.variant === "note" ? { class: "note" } : {}),
          },
        },
      },
    ];
  },
});

/* Issues from validation, shown on the node they point at. */

export const issuesKey = new PluginKey<DecorationSet>("templateIssues");

/** The node at a path of child indexes, and where it starts. */
export function resolvePath(
  doc: PMNode,
  path: readonly number[],
): { pos: number; node: PMNode } | null {
  let node = doc;
  let pos = -1;
  for (const index of path) {
    if (index >= node.childCount) return null;
    let child = pos + 1;
    for (let i = 0; i < index; i += 1) child += node.child(i).nodeSize;
    pos = child;
    node = node.child(index);
  }
  return { pos, node };
}

function decorations(doc: PMNode, issues: readonly TemplateIssue[]): DecorationSet {
  const list: Decoration[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) continue;
    const found = resolvePath(doc, issue.path);
    if (!found) continue;
    const { pos, node } = found;
    list.push(
      Decoration.node(pos, pos + node.nodeSize, { class: "qbt-issue", title: issue.message }),
    );
    if (node.isBlock) {
      list.push(
        Decoration.widget(
          pos + node.nodeSize,
          () => {
            const element = document.createElement("div");
            element.className = "qbt-issue-message";
            element.textContent = issue.message;
            element.setAttribute("contenteditable", "false");
            return element;
          },
          { side: -1, key: `${issue.path.join(".")}:${issue.message}` },
        ),
      );
    }
  }
  return DecorationSet.create(doc, list);
}

export const Issues = Extension.create({
  name: "templateIssues",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: issuesKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const issues = tr.getMeta(issuesKey) as TemplateIssue[] | undefined;
            if (issues) return decorations(tr.doc, issues);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => issuesKey.getState(state) },
      }),
    ];
  },
});

export function showIssues(editor: Editor, issues: readonly TemplateIssue[]): void {
  editor.view.dispatch(editor.state.tr.setMeta(issuesKey, issues).setMeta("addToHistory", false));
}

export function templateExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      code: false,
      strike: false,
      link: false,
      // An empty paragraph after the signature would print as blank space.
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
    }),
    TextAlign.configure({
      types: ["heading", "paragraph"],
      alignments: ["left", "center", "right", "justify"],
    }),
    ParagraphVariant,
    Variable,
    CheckMark,
    CheckOption,
    Conditional,
    Repeat,
    PageBreak,
    Signature,
    PageFooter,
    // Fixed tables of paper forms. Columns share the width, as in the PDF.
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: "qbt-table" } } }),
    Issues,
  ];
}

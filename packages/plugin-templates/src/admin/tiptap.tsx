"use client";

/** The TipTap editor, loaded lazily by the workspace. */
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EditorMetaContext, resolvePath, showIssues, templateExtensions } from "./extensions";

import type { TemplateContent } from "../content";
import type { CatalogVariable } from "../kinds";
import type { EditorApi, TemplateEditorProps } from "./editor-types";
import type { Editor } from "@tiptap/core";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const plain = (json: unknown) => JSON.parse(JSON.stringify(json)) as TemplateContent;

/* Toolbar */

type Style = "p" | "h1" | "h2" | "h3" | "note";

const styles: { value: Style; label: string }[] = [
  { value: "p", label: "Paragraph" },
  { value: "h1", label: "Title" },
  { value: "h2", label: "Heading" },
  { value: "h3", label: "Subheading" },
  { value: "note", label: "Note" },
];

/* 20px icons, 1.6 stroke. */
const paths = {
  undo: "M7.5 6 4 9.5 7.5 13M4 9.5h8a4 4 0 0 1 0 8h-2",
  redo: "M12.5 6 16 9.5 12.5 13M16 9.5H8a4 4 0 0 0 0 8h2",
  bold: "M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3.5 3.5 0 0 1 0 7H6z",
  italic: "M12 4H8.5M11.5 16H8M11 4 9 16",
  underline: "M6 4v5a4 4 0 0 0 8 0V4M5 17h10",
  left: "M3.5 5h13M3.5 8.5h8M3.5 12h13M3.5 15.5h8",
  center: "M3.5 5h13M6 8.5h8M3.5 12h13M6 15.5h8",
  right: "M3.5 5h13M8.5 8.5h8M3.5 12h13M8.5 15.5h8",
  justify: "M3.5 5h13M3.5 8.5h13M3.5 12h13M3.5 15.5h13",
  bullets: "M8 5.5h9M8 10h9M8 14.5h9M4 5.5h.01M4 10h.01M4 14.5h.01",
  ordered: "M8.5 5.5h8.5M8.5 10h8.5M8.5 14.5h8.5M3.5 4.5l1-.5v3.5M3.5 13.5h2l-2 2.5h2",
  quote: "M4.5 9.5h3v4h-3v-4c0-2 .5-3.5 2.5-4.5M11.5 9.5h3v4h-3v-4c0-2 .5-3.5 2.5-4.5",
  rule: "M3.5 10h13",
} as const;

function Tool({
  label,
  icon,
  active,
  onClick,
}: Readonly<{ label: string; icon: keyof typeof paths; active?: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={cx("qbt-tool", active && "qbt-tool-active")}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="qbt:size-4"
        aria-hidden="true"
      >
        <path d={paths[icon]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function activeStyle(editor: Editor): Style {
  for (const level of [1, 2, 3] as const)
    if (editor.isActive("heading", { level })) return `h${String(level)}` as Style;
  return editor.isActive("paragraph", { variant: "note" }) ? "note" : "p";
}

function setStyle(editor: Editor, style: Style) {
  const chain = editor.chain().focus();
  if (style === "p") chain.setParagraph().updateAttributes("paragraph", { variant: null }).run();
  else if (style === "note")
    chain.setParagraph().updateAttributes("paragraph", { variant: "note" }).run();
  else chain.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 }).run();
}

const Sep = () => <span aria-hidden="true" className="qbt:mx-1 qbt:h-5 qbt:w-px qbt:bg-zinc-200" />;

function Toolbar({ editor }: Readonly<{ editor: Editor }>) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: activeStyle(e),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      align:
        (["left", "center", "right", "justify"] as const).find((a) =>
          e.isActive({ textAlign: a }),
        ) ?? null,
      bullets: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      table: e.isActive("table"),
    }),
  });
  const run = (fn: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => {
    fn(editor.chain().focus()).run();
  };
  return (
    <div role="toolbar" aria-label="Formatting" className="qbt-toolbar">
      <Tool label="Undo" icon="undo" onClick={run((c) => c.undo())} />
      <Tool label="Redo" icon="redo" onClick={run((c) => c.redo())} />
      <Sep />
      <select
        aria-label="Text style"
        value={state.style}
        onChange={(event) => {
          setStyle(editor, event.target.value as Style);
        }}
        className="qbt:h-8 qbt:rounded-md qbt:border qbt:border-zinc-300 qbt:bg-white qbt:px-2 qbt:text-sm"
      >
        {styles.map((style) => (
          <option key={style.value} value={style.value}>
            {style.label}
          </option>
        ))}
      </select>
      <Sep />
      <Tool label="Bold" icon="bold" active={state.bold} onClick={run((c) => c.toggleBold())} />
      <Tool
        label="Italic"
        icon="italic"
        active={state.italic}
        onClick={run((c) => c.toggleItalic())}
      />
      <Tool
        label="Underline"
        icon="underline"
        active={state.underline}
        onClick={run((c) => c.toggleUnderline())}
      />
      <Sep />
      {(["left", "center", "right", "justify"] as const).map((align) => (
        <Tool
          key={align}
          label={`Align ${align}`}
          icon={align}
          active={state.align === align}
          onClick={run((c) => c.setTextAlign(align))}
        />
      ))}
      <Sep />
      <Tool
        label="Bulleted list"
        icon="bullets"
        active={state.bullets}
        onClick={run((c) => c.toggleBulletList())}
      />
      <Tool
        label="Numbered list"
        icon="ordered"
        active={state.ordered}
        onClick={run((c) => c.toggleOrderedList())}
      />
      <Tool
        label="Quote"
        icon="quote"
        active={state.quote}
        onClick={run((c) => c.toggleBlockquote())}
      />
      <Tool label="Horizontal rule" icon="rule" onClick={run((c) => c.setHorizontalRule())} />
      {state.table ? (
        <>
          <Sep />
          {(
            [
              ["Add row", (c) => c.addRowAfter()],
              ["Add column", (c) => c.addColumnAfter()],
              ["Delete row", (c) => c.deleteRow()],
              ["Delete column", (c) => c.deleteColumn()],
              ["Merge or split", (c) => c.mergeOrSplit()],
              ["Header row", (c) => c.toggleHeaderRow()],
              ["Delete table", (c) => c.deleteTable()],
            ] as const satisfies readonly (readonly [
              string,
              (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>,
            ])[]
          ).map(([label, fn]) => (
            <button
              key={label}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={run(fn)}
              className="qbt-text-tool"
            >
              {label}
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}

/* Side panel: blocks and variables. */

const blocks = [
  { key: "checkOption", label: "Checkbox option", hint: "Checked by a condition" },
  { key: "checkMark", label: "Inline checkbox", hint: "A box inside the text" },
  { key: "conditional", label: "Conditional block", hint: "Printed only if…" },
  { key: "repeat", label: "Repeated list", hint: "Table or bullets" },
  { key: "table", label: "Table", hint: "Header and rows to fill in" },
  { key: "pageBreak", label: "Page break", hint: "" },
  { key: "signature", label: "Signature", hint: "Line and caption" },
  { key: "pageFooter", label: "Page footer", hint: "On every page" },
] as const;

type BlockKey = (typeof blocks)[number]["key"];

export function insertBlock(editor: Editor, key: BlockKey, list?: CatalogVariable): void {
  const chain = editor.chain().focus();
  switch (key) {
    case "checkOption":
      chain
        .insertContent({
          type: "checkOption",
          attrs: { expr: "" },
          content: [{ type: "text", text: "Option text" }],
        })
        .run();
      return;
    case "checkMark":
      chain.insertContent({ type: "checkMark", attrs: { expr: "" } }).run();
      return;
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    case "conditional":
      chain
        .insertContent({
          type: "conditional",
          attrs: { expr: "" },
          content: [{ type: "paragraph" }],
        })
        .run();
      return;
    case "repeat":
      chain
        .insertContent({
          type: "repeat",
          attrs: {
            list: list?.path ?? "",
            display: "table",
            columns: (list?.fields ?? []).map((f) => ({ field: f.key, header: f.label })),
            empty: "blank",
          },
        })
        .run();
      return;
    case "pageBreak":
      chain.insertContent({ type: "pageBreak" }).run();
      return;
    case "signature":
      chain.insertContent({ type: "signature", attrs: { caption: "Signature" } }).run();
      return;
    default: {
      // One footer, at the end: go to the existing one or add it.
      const offsets: number[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === "pageFooter") offsets.push(offset);
      });
      const at = offsets.at(-1);
      if (at === undefined) {
        chain
          .insertContentAt(editor.state.doc.content.size, {
            type: "pageFooter",
            content: [{ type: "text", text: "Footer text" }],
          })
          .run();
      } else
        chain
          .setTextSelection(at + 1)
          .scrollIntoView()
          .run();
    }
  }
}

const typeHints: Record<CatalogVariable["type"], string> = {
  text: "",
  number: "number",
  date: "date",
  boolean: "yes/no",
  enum: "options",
  list: "list",
};

function SidePanel({
  editor,
  catalog,
}: Readonly<{ editor: Editor; catalog: readonly CatalogVariable[] }>) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = catalog.filter(
    (v) => !q || v.label.toLowerCase().includes(q) || v.path.toLowerCase().includes(q),
  );
  const groups = [...new Set(shown.map((v) => v.group))];
  const insert = (variable: CatalogVariable) => {
    if (variable.type === "list") insertBlock(editor, "repeat", variable);
    else
      editor
        .chain()
        .focus()
        .insertContent({ type: "variable", attrs: { path: variable.path, transform: null } })
        .run();
  };
  return (
    <aside aria-label="Insert" className="qbt-side">
      <section className="qbt:border-b qbt:border-zinc-200 qbt:p-3">
        <h2 className="qbt-side-title">Blocks</h2>
        <ul className="qbt:mt-1.5 qbt:space-y-0.5">
          {blocks.map((block) => (
            <li key={block.key}>
              <button
                type="button"
                onClick={() => {
                  insertBlock(editor, block.key);
                }}
                className="qbt-side-item"
              >
                <span className="qbt:block qbt:text-sm qbt:text-zinc-900">{block.label}</span>
                {block.hint ? (
                  <span className="qbt:block qbt:text-xs qbt:text-zinc-500">{block.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="qbt:p-3">
        <h2 className="qbt-side-title">Variables</h2>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search variables"
          aria-label="Search variables"
          className="qbt:mt-1.5 qbt:h-8 qbt:w-full qbt:rounded-md qbt:border qbt:border-zinc-300 qbt:bg-white qbt:px-2 qbt:text-sm"
        />
        {groups.map((group) => (
          <div key={group} className="qbt:mt-3">
            <h3 className="qbt:text-xs qbt:font-medium qbt:text-zinc-500">{group}</h3>
            <ul className="qbt:mt-1 qbt:space-y-0.5">
              {shown
                .filter((v) => v.group === group)
                .map((variable) => (
                  <li key={variable.path}>
                    <button
                      type="button"
                      onClick={() => {
                        insert(variable);
                      }}
                      title={variable.hint ?? variable.path}
                      aria-label={`Insert ${variable.label}`}
                      className="qbt-side-item"
                    >
                      <span className="qbt:flex qbt:items-baseline qbt:justify-between qbt:gap-2">
                        <span className="qbt:text-sm qbt:text-zinc-900">{variable.label}</span>
                        {typeHints[variable.type] ? (
                          <span className="qbt:shrink-0 qbt:text-[11px] qbt:text-zinc-400">
                            {typeHints[variable.type]}
                          </span>
                        ) : null}
                      </span>
                      <code className="qbt:block qbt:truncate qbt:text-[11px] qbt:text-zinc-500">
                        {variable.path}
                      </code>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {shown.length === 0 ? (
          <p className="qbt:mt-3 qbt:text-xs qbt:text-zinc-500">No variables match.</p>
        ) : null}
      </section>
    </aside>
  );
}

/** The editor: toolbar, side panel and document. */
export default function TemplateEditor({
  catalog,
  initialContent,
  editable,
  onChange,
  onReady,
}: Readonly<TemplateEditorProps>) {
  const callbacks = useRef({ onChange, onReady });
  callbacks.current = { onChange, onReady };
  const editor = useEditor({
    extensions: templateExtensions(),
    content: initialContent,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "qbt-doc",
        "aria-label": "Template text",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: updated }) => {
      callbacks.current.onChange(plain(updated.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const api: EditorApi = {
      // A plain copy: ProseMirror attrs are not plain objects, and server actions only take those.
      getContent: () => plain(editor.getJSON()),
      setContent: (content) => {
        editor.commands.setContent(content, { emitUpdate: false });
      },
      showIssues: (issues) => {
        showIssues(editor, issues);
      },
      focusIssue: (issue) => {
        const found = resolvePath(editor.state.doc, issue.path);
        if (found) editor.chain().focus().setNodeSelection(found.pos).scrollIntoView().run();
      },
    };
    callbacks.current.onReady(api);
  }, [editor]);

  const meta = useMemo(() => ({ catalog, readOnly: !editable }), [catalog, editable]);

  return (
    <EditorMetaContext.Provider value={meta}>
      <div className="qbt-editor">
        {editor && editable ? <SidePanel editor={editor} catalog={catalog} /> : null}
        <div className="qbt-main">
          {editor && editable ? <Toolbar editor={editor} /> : null}
          <div className="qbt-paper-wrap">
            <div className="qbt-paper">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>
    </EditorMetaContext.Provider>
  );
}

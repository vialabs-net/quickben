import { readFile } from "node:fs/promises";
import path from "node:path";

import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { codeToHast } from "shiki";

import type { ReactNode } from "react";

/** Read a file from `samples/`. Samples are typechecked, so the landing page shows checked code. */
export async function readSample(name: string): Promise<string> {
  const file = path.join(process.cwd(), "samples", name);
  return (await readFile(file, "utf8")).trimEnd();
}

/** Highlight TypeScript at build time with light and dark themes. `marks` maps line numbers to note numbers. */
export async function highlight(
  code: string,
  marks: Readonly<Record<number, number>> = {},
): Promise<ReactNode> {
  const tree = await codeToHast(code, {
    lang: "ts",
    themes: { light: "github-light", dark: "github-dark-dimmed" },
    defaultColor: false,
    transformers: [
      {
        line(node, line) {
          const note = marks[line];
          if (note === undefined) return;
          this.addClassToHast(node, "qb-mark");
          node.properties["data-note"] = String(note);
        },
      },
    ],
  });
  // The package types its result as the global `JSX.Element`, which React 19 types no longer declare.
  return toJsxRuntime(tree, { Fragment, jsx, jsxs }) as ReactNode;
}

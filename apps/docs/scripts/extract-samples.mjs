// Writes every ```ts and ```tsx block in content/**/*.mdx to samples/generated/ so `tsc`
// checks it against the workspace packages.
//
// - A block with `filename="a/b.ts"` is written to that path inside the page's folder, so
//   blocks on one page can import each other.
// - Imports of `quickben.config` point to the page's own `quickben.config.ts` block when there
//   is one, else to samples/quickben.config.ts. Imports of `collections` point to
//   samples/prelude.ts.
// - Mark a block `nocheck` to skip it (signatures, excerpts, third-party APIs).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const contentDir = path.join(root, "content");
const samplesDir = path.join(root, "samples");
const outDir = path.join(samplesDir, "generated");

async function* mdxFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* mdxFiles(full);
    else if (entry.name.endsWith(".mdx")) yield full;
  }
}

const fence = /^```(ts|tsx)([^\n]*)\n([\s\S]*?)^```$/gm;

function importPath(fromFile, target) {
  const relative = path.relative(path.dirname(fromFile), target).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

await rm(outDir, { recursive: true, force: true });
let count = 0;
for await (const file of mdxFiles(contentDir)) {
  const source = await readFile(file, "utf8");
  const page = path.relative(contentDir, file).replace(/\.mdx$/, "");
  const pageDir = path.join(outDir, page);
  const blocks = [];
  let index = 0;
  for (const match of source.matchAll(fence)) {
    const [, lang, meta, code] = match;
    index += 1;
    if (/\bnocheck\b/.test(meta)) continue;
    const name = /filename="([^"]+)"/.exec(meta)?.[1];
    const target = path.join(pageDir, name ?? `block-${index}.${lang}`);
    const line = source.slice(0, match.index).split("\n").length;
    blocks.push({ target, code, line });
  }
  const ownConfig = blocks.find((b) => path.basename(b.target) === "quickben.config.ts");
  for (const { target, code, line } of blocks) {
    const config =
      ownConfig && ownConfig.target !== target
        ? ownConfig.target
        : path.join(samplesDir, "quickben.config.ts");
    const prelude = importPath(target, path.join(samplesDir, "prelude"));
    const body = code
      .replaceAll(
        /from "(?:\.\.?\/)+quickben\.config"/g,
        `from "${importPath(target, config).replace(/\.ts$/, "")}"`,
      )
      .replaceAll(/from "(?:\.\.?\/)+collections"/g, `from "${prelude}"`);
    const header = `// From content/${page}.mdx:${line}. Generated; do not edit.\n`;
    const preludeImport = target.endsWith(".d.ts") ? "" : `import "${prelude}";\n`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${header}${preludeImport}${body}`);
    count += 1;
  }
}
console.warn(`extract-samples: ${count} code blocks written to samples/generated/`);

import nextra from "nextra";

const withNextra = nextra({
  contentDirBasePath: "/docs",
  defaultShowCopyCode: true,
  search: { codeblocks: false },
});

// DOCS_STATIC_EXPORT=1 builds a static site in `out/` (GitHub Pages).
// Without it the app builds for a Node/Vercel runtime.
const staticExport = process.env.DOCS_STATIC_EXPORT === "1";

export default withNextra({
  reactStrictMode: true,
  ...(staticExport ? { output: "export", images: { unoptimized: true }, trailingSlash: true } : {}),
});

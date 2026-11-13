import type { NextConfig } from "next";

const cacheComponents = process.env.QUICKBEN_CACHE_COMPONENTS !== "0";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly from its package folder. Keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // On by default, like a new create-next-app project. CI also builds with
  // QUICKBEN_CACHE_COMPONENTS=0 to check that Quickben works without it.
  cacheComponents,
  partialPrefetching: cacheComponents,
};

export default nextConfig;

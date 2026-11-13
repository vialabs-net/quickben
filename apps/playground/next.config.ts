import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Database drivers load native code or WASM at runtime. Keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "@libsql/client", "pg"],
};

export default nextConfig;

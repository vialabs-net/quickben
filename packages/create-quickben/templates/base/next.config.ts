import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded by Node at runtime instead of bundled. Database drivers use native code or WASM,
  // and the Drizzle adapter imports only the driver you installed.
  serverExternalPackages: [
    "@quickben/db-drizzle",
    "drizzle-orm",
    "@electric-sql/pglite",
    "@libsql/client",
    "pg",
  ],
};

export default nextConfig;

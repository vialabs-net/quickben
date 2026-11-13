import { defineConfig } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

import { notes } from "./collections";

// The CLI loads this file with jiti. Importing `../../src` here would load the sources a second
// time outside Vitest and break coverage, so the adapter only looks like a Drizzle adapter.
const db = Object.assign(memoryAdapter(), { name: "drizzle", dialect: "pglite" });

export default defineConfig({ db, collections: [notes] });

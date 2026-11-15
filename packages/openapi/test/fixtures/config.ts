import { defineCollection, defineConfig, fields } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";

import type { OpenApiOptions } from "../../src/types";

const notes = defineCollection({
  slug: "notes",
  fields: { text: fields.text({ required: true }) },
  api: { openapi: true },
});

export const openapi: OpenApiOptions = { info: { title: "Notes", version: "1.0.0" } };

export default defineConfig({ db: memoryAdapter(), collections: [notes] });

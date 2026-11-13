import { defineCollection, defineConfig, fields as f } from "@quickben/core";

import { appAuth } from "./lib/auth";
import { createDb } from "./lib/db";

export const notes = defineCollection({
  slug: "notes",
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    body: f.textarea(),
  },
  // Anyone can read. Without a rule, create, update and delete need a signed-in user.
  access: { read: () => true },
  admin: { useAsTitle: "title", defaultColumns: ["title", "updatedAt"] },
});

const config = defineConfig({
  db: createDb(),
  collections: [notes],
  auth: appAuth(),
  admin: { title: "{{name}}" },
});

export default config;

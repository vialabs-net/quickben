import { defineCollection, fields as f } from "@quickben/core";

export const notes = defineCollection({
  slug: "notes",
  fields: { text: f.text({ required: true }), tags: f.select({ options: ["a", "b"], many: true }) },
});

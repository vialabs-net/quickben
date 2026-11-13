/**
 * Seed the playground database: `pnpm seed`. The dev server also seeds an empty database on
 * start. With `QUICKBEN_DB=memory` the data lives only in this process, so this only checks
 * that seeding works.
 */
import { createQuickben } from "@quickben/core";

import { seed } from "../lib/seed";
import config from "../quickben.config";

const qb = await createQuickben(config);
const system = { user: null, overrideAccess: true };
const posts = await qb.count("posts", {}, system);
if (posts > 0) {
  console.warn(`The database already has ${String(posts)} posts. Nothing to do.`);
} else {
  const { created } = await seed(qb);
  console.warn(`Created ${String(created)} documents.`);
}
await qb.db.close?.();

/**
 * Seed the playground database: `pnpm seed`.
 *
 * With the default in-memory database the data lives only in this process, so this just
 * checks that seeding works; the dev server seeds itself on start. With a persistent database
 * (see lib/db.ts) it fills the database for the dev server.
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

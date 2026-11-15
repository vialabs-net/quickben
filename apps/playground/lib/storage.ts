import { localFileStorage } from "@quickben/storage-local";

/**
 * Files of the playground: author photos, the brand logo and documents to read. They are kept
 * in `./.uploads`; `pnpm db:reset` removes them. In production use `@quickben/storage-gcs` or
 * `@quickben/storage-s3`.
 */
export const playgroundStorage = localFileStorage({ root: "./.uploads" });

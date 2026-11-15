import { describe, expectTypeOf, test } from "vitest";

import { defineCollection, defineConfig, fields as f } from "../src";

import type {
  DatabaseAdapter,
  FileField,
  FileFieldKey,
  FileRef,
  FileUpload,
  InferCreateInput,
  InferDoc,
  InferRegistry,
  InferSort,
  InferUpdateInput,
  InferWhere,
  Quickben,
  StorageAdapter,
  StoredFile,
} from "../src";

declare const db: DatabaseAdapter;
declare const storage: StorageAdapter;

const docs = defineCollection({
  slug: "docs",
  fields: {
    title: f.text(),
    logo: f.file({ accept: ["image/*"], maxBytes: 1024 }),
    contract: f.file({ required: true, storage }),
  },
});
const config = defineConfig({ db, storage, collections: [docs] });

describe("file fields", () => {
  test("the factory returns a FileField", () => {
    expectTypeOf(f.file()).toEqualTypeOf<FileField<false>>();
    expectTypeOf(f.file({ required: true })).toEqualTypeOf<FileField<true>>();
  });

  test("documents store references", () => {
    type Doc = InferDoc<typeof docs>;
    expectTypeOf<Doc["logo"]>().toEqualTypeOf<FileRef | null>();
    expectTypeOf<Doc["contract"]>().toEqualTypeOf<FileRef>();
  });

  test("input takes uploads, references or null", () => {
    type Create = InferCreateInput<typeof docs>;
    expectTypeOf<Create["contract"]>().toEqualTypeOf<FileRef | FileUpload>();
    expectTypeOf<Create["logo"]>().toEqualTypeOf<FileRef | FileUpload | null | undefined>();
    expectTypeOf<InferUpdateInput<typeof docs>["contract"]>().toEqualTypeOf<
      FileRef | FileUpload | undefined
    >();
    expectTypeOf<Blob>().toExtend<FileUpload>();
    expectTypeOf<{ name: string; bytes: Uint8Array }>().toExtend<FileUpload>();
  });

  test("files only filter with exists and do not sort", () => {
    type Where = NonNullable<InferWhere<typeof docs>["logo"]>;
    expectTypeOf<keyof Where>().toEqualTypeOf<"exists">();
    expectTypeOf<"logo">().not.toExtend<InferSort<typeof docs>>();
  });

  test("the config carries the storage", () => {
    expectTypeOf(config.storage).toEqualTypeOf<StorageAdapter | undefined>();
  });

  test("readFile takes file field names only", () => {
    type R = InferRegistry<typeof config>;
    expectTypeOf<FileFieldKey<R["docs"]>>().toEqualTypeOf<"logo" | "contract">();
    expectTypeOf<Quickben<R>["readFile"]>().returns.toEqualTypeOf<Promise<StoredFile>>();
    expectTypeOf<Quickben<R>["readFile"]>().parameter(2).toEqualTypeOf<"logo" | "contract">();
  });
});

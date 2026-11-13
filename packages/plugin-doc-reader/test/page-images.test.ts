import { describe, expect, it } from "vitest";

import { rasterize, UnsupportedFileError } from "../src";

import { makePdf, PNG } from "./helpers";

describe("rasterize", () => {
  it("renders the requested PDF pages as PNG and skips pages past the end", async () => {
    const images = await rasterize(await makePdf(["one", "two"]), "application/pdf", [2, 5]);
    expect(images.map((image) => [image.page, image.mime])).toEqual([[2, "image/png"]]);
    expect(images[0]?.bytes.subarray(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });

  it("passes images through and refuses other files", async () => {
    expect(await rasterize(PNG, "image/png", [1, 2])).toEqual([
      { page: 1, bytes: PNG, mime: "image/png" },
    ]);
    await expect(rasterize(new Uint8Array([1]), "text/plain", [1])).rejects.toThrow(
      UnsupportedFileError,
    );
  });
});

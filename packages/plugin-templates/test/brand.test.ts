import { describe, expect, it } from "vitest";

import {
  BRANDS,
  checkFont,
  checkLogo,
  isHexColor,
  isWoff2,
  parseDataUrl,
  saveBrand,
  sniffImage,
  toDataUrl,
} from "../src";
import { cleanText, fromBase64, toBase64 } from "../src/brand";

import { setup, system } from "./fixtures";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0]);

describe("files", () => {
  it("sniffs images and fonts by their bytes", () => {
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(jpeg)).toBe("image/jpeg");
    expect(sniffImage(webp)).toBe("image/webp");
    expect(sniffImage(woff2)).toBeNull();
    expect(isWoff2(woff2)).toBe(true);
    expect(isWoff2(png)).toBe(false);
  });

  it("round-trips base64 and data URLs", () => {
    const big = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(parseDataUrl(toDataUrl(png, "image/png"))).toEqual({
      mimeType: "image/png",
      bytes: png,
    });
    expect(parseDataUrl("data:image/png,raw")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,A")).toBeNull();
  });

  it("checks logos and fonts", () => {
    expect(checkLogo(toDataUrl(png, "image/png"))).toBe(true);
    expect(checkLogo("asset-ref")).toBe(true);
    expect(checkLogo("data:x")).toBe("Invalid data URL");
    expect(checkLogo(toDataUrl(png, "image/jpeg"))).toContain("PNG, JPEG or WebP");
    expect(checkLogo(toDataUrl(new Uint8Array(600_000), "image/png"))).toContain("512 KB");
    expect(checkFont(toDataUrl(woff2, "font/woff2"))).toBe(true);
    expect(checkFont("asset-ref")).toBe(true);
    expect(checkFont("data:x")).toBe("Invalid data URL");
    expect(checkFont(toDataUrl(png, "font/woff2"))).toContain("woff2");
    expect(checkFont(toDataUrl(new Uint8Array(600_000), "font/woff2"))).toContain("512 KB");
  });

  it("cleans text and checks colors", () => {
    expect(cleanText("  a \n b ", 10)).toBe("a b");
    expect(cleanText("   ", 10)).toBeNull();
    expect(cleanText(3, 10)).toBeNull();
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(isHexColor("#A1b2C3")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
  });
});

describe("brands collection", () => {
  it("keeps one brand and validates its fields", async () => {
    const qb = await setup();
    const brand = await saveBrand(qb, { displayName: "Acme" }, system);
    expect(brand).toMatchObject({ key: "global", primaryColor: "#111827", font: "sans" });
    await expect(qb.create(BRANDS, {}, system)).rejects.toThrow();
    await expect(saveBrand(qb, { primaryColor: "red" }, system)).rejects.toThrow("#1d4ed8");
    await expect(saveBrand(qb, { font: "custom" }, system)).rejects.toThrow("Upload a font first");
    await expect(saveBrand(qb, { logo: toDataUrl(woff2, "image/png") }, system)).rejects.toThrow(
      "PNG",
    );
    await expect(
      saveBrand(qb, { customFont: { name: "F", regular: toDataUrl(png, "font/woff2") } }, system),
    ).rejects.toThrow("woff2");
    await expect(
      saveBrand(
        qb,
        { customFont: { name: "F", regular: "ref", bold: toDataUrl(png, "font/woff2") } },
        system,
      ),
    ).rejects.toThrow("woff2");
    const saved = await saveBrand(
      qb,
      { customFont: { name: "F", regular: "ref" }, font: "custom" },
      system,
    );
    expect(saved.font).toBe("custom");
  });
});

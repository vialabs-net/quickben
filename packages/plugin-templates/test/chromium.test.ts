import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RendererUnavailableError } from "../src";
import { chromiumPath, chromiumRenderer } from "../src/chromium";

import type { ChromiumRenderer } from "../src/chromium";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  newContext: vi.fn(),
  contextClose: vi.fn(),
  browserClose: vi.fn(),
  setContent: vi.fn(),
  pdf: vi.fn(),
  cdpSend: vi.fn(),
  route: vi.fn(),
  load: vi.fn(),
  drawPage: vi.fn(),
  embedPdf: vi.fn(),
  disconnected: [] as (() => void)[],
}));

vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("pdf-lib", () => ({ PDFDocument: { load: mocks.load } }));

let renderer: ChromiumRenderer;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.disconnected.length = 0;
  mocks.contextClose.mockResolvedValue(undefined);
  mocks.browserClose.mockResolvedValue(undefined);
  mocks.setContent.mockResolvedValue(undefined);
  mocks.pdf.mockResolvedValue(Buffer.from("pdf"));
  mocks.cdpSend.mockResolvedValue(undefined);
  mocks.route.mockImplementation(async (_pattern: string, handler: (route: unknown) => unknown) => {
    for (const url of ["data:x", "about:blank", "https://evil.test/x"]) {
      await handler({
        request: () => ({ url: () => url }),
        continue: () => Promise.resolve("continue"),
        abort: () => Promise.resolve("abort"),
      });
    }
  });
  mocks.newContext.mockImplementation(() =>
    Promise.resolve({
      close: mocks.contextClose,
      route: mocks.route,
      newPage: () =>
        Promise.resolve({
          setContent: mocks.setContent,
          evaluate: () => Promise.reject(new Error("no js")),
          pdf: mocks.pdf,
        }),
      newCDPSession: () => Promise.resolve({ send: mocks.cdpSend }),
    }),
  );
  mocks.launch.mockResolvedValue({
    newContext: mocks.newContext,
    close: mocks.browserClose,
    on: (_event: string, listener: () => void) => mocks.disconnected.push(listener),
  });
  mocks.embedPdf.mockResolvedValue([{ id: "frame" }]);
  mocks.load.mockResolvedValue({
    embedPdf: mocks.embedPdf,
    getPages: () => [{ getSize: () => ({ width: 612, height: 792 }), drawPage: mocks.drawPage }],
    setTitle: vi.fn(),
    setAuthor: vi.fn(),
    setCreator: vi.fn(),
    setProducer: vi.fn(),
    save: () => Promise.resolve(new Uint8Array([9])),
  });
  renderer = chromiumRenderer({
    executablePath: "/bin/chromium",
    timeoutMs: 1000,
    concurrency: 1,
    maxQueue: 2,
  });
});

afterEach(async () => {
  await renderer.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("chromiumRenderer", () => {
  it("renders the body and draws the cached letterhead on every page", async () => {
    const input = { title: "T", author: "A", html: "<p>x</p>", letterhead: "<div>head</div>" };
    expect(await renderer.render(input)).toEqual(new Uint8Array([9]));
    await renderer.render({ ...input, author: null });
    // Body twice, letterhead once (cached).
    expect(mocks.setContent).toHaveBeenCalledTimes(3);
    expect(mocks.cdpSend).toHaveBeenCalledTimes(1);
    expect(mocks.drawPage).toHaveBeenCalledWith(
      { id: "frame" },
      { x: 0, y: 0, width: 612, height: 792 },
    );
    expect(mocks.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false, offline: true });
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.contextClose).toHaveBeenCalledTimes(3);
  });

  it("maps launch and page failures and always closes the context", async () => {
    mocks.launch.mockRejectedValueOnce(new Error("launch failed"));
    await expect(renderer.htmlToPdf("doc")).rejects.toBeInstanceOf(RendererUnavailableError);
    mocks.setContent.mockRejectedValueOnce(new Error("page failed"));
    await expect(renderer.htmlToPdf("doc")).rejects.toThrow("The PDF renderer failed");
    expect(mocks.contextClose).toHaveBeenCalledTimes(1);
    expect(await renderer.htmlToPdf("healthy")).toEqual(new Uint8Array(Buffer.from("pdf")));
  });

  it("bounds the queue, expires waiting renders and times out slow ones", async () => {
    mocks.pdf.mockImplementationOnce(() => new Promise(() => undefined));
    const slow = renderer.htmlToPdf("slow").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    const queued = [renderer.htmlToPdf("a"), renderer.htmlToPdf("b")].map((p) =>
      p.catch((e: unknown) => e),
    );
    await expect(renderer.htmlToPdf("overflow")).rejects.toThrow("busy");
    await vi.advanceTimersByTimeAsync(1100);
    expect(await slow).toBeInstanceOf(RendererUnavailableError);
    const results = await Promise.all(queued);
    expect(
      results.every((r) => r instanceof RendererUnavailableError || r instanceof Uint8Array),
    ).toBe(true);
    expect(await renderer.htmlToPdf("after")).toBeInstanceOf(Uint8Array);
  });

  it("starts a new browser after a disconnect and closes it when idle", async () => {
    await renderer.htmlToPdf("one");
    for (const listener of mocks.disconnected) listener();
    await renderer.htmlToPdf("two");
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(mocks.browserClose).toHaveBeenCalled();
  });

  it("needs a Chromium binary", async () => {
    const missing = chromiumRenderer({ executablePath: "" });
    vi.stubEnv("CHROMIUM_PATH", "/nowhere/chromium");
    await expect(missing.htmlToPdf("x")).rejects.toThrow("CHROMIUM_PATH");
    vi.unstubAllEnvs();
    await missing.close();
  });
});

describe("chromiumPath", () => {
  it("uses CHROMIUM_PATH when it exists", () => {
    expect(chromiumPath("/nowhere/chromium")).toBeNull();
    expect(chromiumPath(process.execPath)).toBe(process.execPath);
    expect(typeof (chromiumPath("") ?? "")).toBe("string");
  });
});

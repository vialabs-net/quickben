/**
 * A PDF renderer with headless Chromium (playwright-core) and pdf-lib. One browser per renderer,
 * started on first use and closed after a few idle minutes; one isolated context per render.
 * Pages run no scripts and load nothing from the network: every asset is a `data:` URL.
 *
 * `playwright-core` and `pdf-lib` are optional peer dependencies: install them to use it.
 */
import { existsSync } from "node:fs";

import { RendererUnavailableError } from "./pdf";

import type { PdfInput, PdfRenderer } from "./pdf";
import type { Browser, BrowserContext } from "playwright-core";

/** Options of {@link chromiumRenderer}. */
export interface ChromiumOptions {
  /** Path of a Chromium or Chrome binary. Default: `CHROMIUM_PATH`, then common install paths. */
  executablePath?: string;
  /** Longest render, queue wait included, in ms. Default 20 000. */
  timeoutMs?: number;
  /** Renders at the same time. Default 2. */
  concurrency?: number;
  /** Renders waiting for a slot; more are refused. Default 8. */
  maxQueue?: number;
  /** Close the browser after this idle time, in ms. Default 5 minutes. */
  idleCloseMs?: number;
  /** `Creator` of the PDF metadata. Default `Quickben`. */
  creator?: string;
}

/** The Chromium renderer, with its lower-level HTML to PDF step. */
export interface ChromiumRenderer extends PdfRenderer {
  /** One HTML page to PDF. `transparent`: no white page background. */
  htmlToPdf(html: string, options?: { transparent?: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
}

const CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

/** The Chromium binary to use: `CHROMIUM_PATH` when it exists, then common paths. `null`: none. */
export function chromiumPath(configured = process.env.CHROMIUM_PATH): string | null {
  const path = configured?.trim();
  if (path) return existsSync(path) ? path : null;
  return CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

const ARGS = [
  // Containers often run as root; pages load only our own HTML.
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
  "--font-render-hinting=none",
  // No network at all: requests are also aborted per page.
  "--proxy-server=127.0.0.1:9",
  "--host-resolver-rules=MAP * ~NOTFOUND",
];

const LETTERHEAD_CACHE = 24;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RendererUnavailableError(`The PDF took longer than ${String(ms)} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A {@link PdfRenderer} with headless Chromium. It renders the body, renders the letterhead once
 * (cached by content), and draws the letterhead over every page with pdf-lib.
 *
 * ```ts
 * templates({ kinds, pdf: chromiumRenderer() });
 * ```
 */
export function chromiumRenderer(options: ChromiumOptions = {}): ChromiumRenderer {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const maxQueue = Math.max(0, options.maxQueue ?? 8);
  const idleCloseMs = options.idleCloseMs ?? 5 * 60_000;
  let browser: Promise<Browser> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let active = 0;
  const waiting: (() => void)[] = [];
  const letterheads = new Map<string, Promise<Uint8Array>>();

  async function launch(): Promise<Browser> {
    const executablePath = options.executablePath ?? chromiumPath();
    if (!executablePath) {
      throw new RendererUnavailableError("Chromium is not installed. Set CHROMIUM_PATH.");
    }
    const { chromium } = await import("playwright-core");
    return chromium.launch({ executablePath, headless: true, args: ARGS });
  }

  function getBrowser(): Promise<Browser> {
    if (!browser) {
      const started = launch();
      browser = started;
      started.then(
        (instance) =>
          instance.on("disconnected", () => {
            if (browser === started) browser = null;
          }),
        () => {
          if (browser === started) browser = null;
        },
      );
    }
    return browser;
  }

  async function close(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = browser;
    browser = null;
    if (current) await current.then((instance) => instance.close()).catch(() => undefined);
  }

  function scheduleIdleClose(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void close(), idleCloseMs);
    if (typeof idleTimer === "object" && "unref" in idleTimer) idleTimer.unref();
  }

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active += 1;
      return;
    }
    if (waiting.length >= maxQueue) throw new RendererUnavailableError("The PDF renderer is busy");
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(ready);
        if (index >= 0) waiting.splice(index, 1);
        reject(new RendererUnavailableError("The PDF renderer is busy. Try again."));
      }, timeoutMs);
      waiting.push(ready);
    });
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
    if (active === 0) scheduleIdleClose();
  }

  async function renderPage(context: BrowserContext, html: string, transparent: boolean) {
    await context.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith("data:") || url === "about:blank"
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    if (transparent) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
    }
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => undefined);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return new Uint8Array(pdf);
  }

  async function htmlToPdf(html: string, pdfOptions: { transparent?: boolean } = {}) {
    const deadline = Date.now() + timeoutMs;
    await acquire();
    if (idleTimer) clearTimeout(idleTimer);
    let context: BrowserContext | null = null;
    let ended = false;
    try {
      const render = async () => {
        const instance = await getBrowser();
        const created = await instance.newContext({ javaScriptEnabled: false, offline: true });
        if (ended) {
          await created.close();
          throw new RendererUnavailableError("The PDF took too long");
        }
        context = created;
        return renderPage(created, html, pdfOptions.transparent ?? false);
      };
      return await withTimeout(render(), Math.max(1, deadline - Date.now()));
    } catch (error) {
      if (error instanceof RendererUnavailableError) throw error;
      throw new RendererUnavailableError("The PDF renderer failed", { cause: error });
    } finally {
      ended = true;
      const opened = context as BrowserContext | null;
      if (opened) await opened.close().catch(() => undefined);
      release();
    }
  }

  async function letterhead(html: string): Promise<Uint8Array> {
    const key = await sha256(html);
    let entry = letterheads.get(key);
    if (!entry) {
      entry = htmlToPdf(html, { transparent: true });
      entry.catch(() => letterheads.delete(key));
      letterheads.set(key, entry);
      while (letterheads.size > LETTERHEAD_CACHE) {
        const oldest = letterheads.keys().next().value;
        if (oldest === undefined) break;
        letterheads.delete(oldest);
      }
    }
    return entry;
  }

  async function render(input: PdfInput): Promise<Uint8Array> {
    const [main, frame, { PDFDocument }] = await Promise.all([
      htmlToPdf(input.html),
      letterhead(input.letterhead),
      import("pdf-lib"),
    ]);
    const pdf = await PDFDocument.load(main);
    const [embedded] = await pdf.embedPdf(frame, [0]);
    if (embedded) {
      for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        page.drawPage(embedded, { x: 0, y: 0, width, height });
      }
    }
    pdf.setTitle(input.title);
    if (input.author) pdf.setAuthor(input.author);
    pdf.setCreator(options.creator ?? "Quickben");
    pdf.setProducer("Quickben");
    return pdf.save();
  }

  return { render, htmlToPdf, close };
}

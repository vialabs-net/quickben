"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Refresh the page every few seconds while something runs in the background. */
export function AutoRefresh({ every = 2000 }: Readonly<{ every?: number }>) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, every);
    return () => {
      clearInterval(timer);
    };
  }, [router, every]);
  return (
    <p role="status" className="qb:text-xs qb:text-zinc-500">
      Running… this page refreshes by itself.
    </p>
  );
}

/** A highlighted value on the previewed page. Corners are page fractions. */
export interface PreviewBox {
  readonly label: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function toBlobUrl(base64: string, mime: string): string {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.codePointAt(0) ?? 0);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

const pct = (n: number) => `${String(Math.round(n * 10_000) / 100)}%`;

/**
 * A PDF or image shown from an object URL, revoked when the preview goes away. Images get the
 * boxes of the values read on them.
 */
export function FilePreview({
  base64,
  mime,
  name,
  boxes = [],
}: Readonly<{ base64: string; mime: string; name: string; boxes?: readonly PreviewBox[] }>) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const created = toBlobUrl(base64, mime);
    setUrl(created);
    return () => {
      URL.revokeObjectURL(created);
    };
  }, [base64, mime]);

  if (!url) {
    return <p className="qb:text-sm qb:text-zinc-500">Loading the file…</p>;
  }
  return (
    <div className="qb:space-y-2">
      {mime.startsWith("image/") ? (
        <div className="qb:relative" style={{ width: "fit-content", maxWidth: "100%" }}>
          {/* An object URL: next/image cannot optimize it. */}
          <img
            src={url}
            alt={name}
            className="qb:block qb:rounded-md qb:ring-1 qb:ring-zinc-200"
            style={{ maxWidth: "100%", maxHeight: "40rem" }}
          />
          {boxes.map((box) => (
            <span
              key={box.label}
              title={box.label}
              aria-hidden="true"
              className="qb:absolute qb:rounded"
              style={{
                left: pct(box.x0),
                top: pct(box.y0),
                width: pct(box.x1 - box.x0),
                height: pct(box.y1 - box.y0),
                outline: "2px solid rgb(37 99 235)",
                background: "rgb(37 99 235 / 0.12)",
              }}
            />
          ))}
        </div>
      ) : (
        <iframe
          src={url}
          title={name}
          className="qb:w-full qb:rounded-md qb:ring-1 qb:ring-zinc-200"
          style={{ height: "40rem" }}
        />
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="qb:text-sm qb:font-medium qb:text-blue-700 qb:hover:underline"
      >
        Open in a new tab
      </a>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { formatBytes } from "../bytes";
import { useAdminI18n } from "../i18n/context";
import { Checkbox } from "../ui/input";

import type { ChangeEvent } from "react";

/** A stored file shown by {@link FileInput}. */
export interface CurrentFile {
  /** Download URL, from the `@quickben/next` route `/:collection/:id/:field`. */
  url: string;
  name: string;
  mime: string;
  size: number;
}

/** Props of {@link FileInput}. */
export interface FileInputProps {
  id: string;
  name: string;
  /** Accepted types, for the `accept` attribute. */
  accept: readonly string[] | undefined;
  /** Largest file in bytes. Larger files block submit. */
  maxBytes: number | undefined;
  /** A file must be chosen: the field is required and nothing is stored yet. */
  required: boolean;
  /** The stored file may be removed (a "remove" checkbox). */
  removable: boolean;
  disabled: boolean;
  describedBy: string;
  current: CurrentFile | null;
}

type PreviewKind = "image" | "pdf" | null;

function previewKind(mime: string): PreviewKind {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  return mime === "application/pdf" ? "pdf" : null;
}

function Preview({
  url,
  mime,
  name,
  label,
}: Readonly<{ url: string; mime: string; name: string; label: string }>) {
  const kind = previewKind(mime);
  if (kind === "image") {
    return (
      <img
        src={url}
        alt={name}
        className="qb:max-h-40 qb:max-w-full qb:rounded-md qb:border qb:border-line qb:bg-surface-muted qb:object-contain"
      />
    );
  }
  if (kind === "pdf") {
    return (
      <details className="qb:text-sm">
        <summary className="qb:cursor-pointer qb:text-fg-muted">{label}</summary>
        <iframe
          src={url}
          title={name}
          loading="lazy"
          className="qb:mt-2 qb:h-96 qb:w-full qb:rounded-md qb:border qb:border-line"
        />
      </details>
    );
  }
  return null;
}

/**
 * File input with a preview of images and PDFs: the stored file, then the chosen one. The
 * browser checks `accept`; this component also blocks files larger than `maxBytes`. The
 * server checks the bytes again.
 */
export function FileInput({
  id,
  name,
  accept,
  maxBytes,
  required,
  removable,
  disabled,
  describedBy,
  current,
}: Readonly<FileInputProps>) {
  const i18n = useAdminI18n();
  const [chosen, setChosen] = useState<{ url: string; mime: string; name: string } | null>(null);

  useEffect(
    () => () => {
      if (chosen) URL.revokeObjectURL(chosen.url);
    },
    [chosen],
  );

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const tooLarge = file !== undefined && maxBytes !== undefined && file.size > maxBytes;
    input.setCustomValidity(
      tooLarge ? i18n.t("error.fileTooLarge", { size: formatBytes(i18n, maxBytes) }) : "",
    );
    setChosen(
      file && !tooLarge
        ? { url: URL.createObjectURL(file), mime: file.type, name: file.name }
        : null,
    );
  };

  const preview = i18n.t("file.preview");
  return (
    <div className="qb:space-y-2">
      {current ? (
        <div className="qb:space-y-2">
          <Preview url={current.url} mime={current.mime} name={current.name} label={preview} />
          <p className="qb:text-sm">
            <a
              href={current.url}
              className="qb:font-medium qb:text-accent qb:underline-offset-2 qb:hover:underline"
              target="_blank"
              rel="noopener"
            >
              {current.name}
            </a>{" "}
            <span className="qb:text-fg-muted">({formatBytes(i18n, current.size)})</span>
          </p>
        </div>
      ) : null}
      {disabled ? null : (
        <input
          id={id}
          name={name}
          type="file"
          accept={accept?.join(",")}
          required={required}
          aria-describedby={describedBy}
          onChange={change}
          className="qb:block qb:w-full qb:text-sm qb:text-fg qb:file:mr-3 qb:file:rounded-md qb:file:border qb:file:border-line-strong qb:file:bg-surface qb:file:px-3 qb:file:py-1.5 qb:file:text-sm qb:file:text-fg"
        />
      )}
      {chosen ? (
        <Preview url={chosen.url} mime={chosen.mime} name={chosen.name} label={preview} />
      ) : null}
      {current && removable && !disabled ? (
        <label className="qb:inline-flex qb:items-center qb:gap-2 qb:text-sm">
          <Checkbox name={`${name}:remove`} />
          {i18n.t("file.remove")}
        </label>
      ) : null}
    </div>
  );
}

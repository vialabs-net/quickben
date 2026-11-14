// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatBytes } from "../src/bytes";
import { FileInput } from "../src/client/file-input";
import { fileUrls, isStoredFile } from "../src/files";
import { parseFormData } from "../src/form-data";
import { formatCell } from "../src/format";
import { englishI18n } from "../src/i18n/translator";
import { formScope } from "../src/ids";
import { isSortable } from "../src/list-query";
import { FieldInput } from "../src/views/field-input";

import type { AdminServerFunction } from "../src";
import type { FileInputProps } from "../src/client/file-input";
import type { CollectionMeta, FieldMeta } from "@quickben/next";

const logoField: FieldMeta = {
  name: "logo",
  type: "file",
  label: "Logo",
  description: null,
  required: false,
  many: false,
  unique: false,
  admin: {},
  accept: ["image/png", "image/jpeg"],
  maxBytes: 1024,
  access: { create: true, update: true },
};
const contractField: FieldMeta = {
  ...logoField,
  name: "contract",
  label: "Contract",
  required: true,
};
const stored = {
  key: "docs/logo/a.png",
  name: "a.png",
  mime: "image/png",
  size: 2048,
  sha256: "x",
};

function renderInput(props: Partial<FileInputProps> = {}) {
  return render(
    <FileInput
      id="logo"
      name="logo"
      accept={["image/png"]}
      maxBytes={1024}
      required={false}
      removable
      disabled={false}
      describedBy="hint"
      current={null}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileInput", () => {
  it("shows the stored image with a link, and a remove checkbox", () => {
    const { container } = renderInput({
      current: { url: "/api/docs/1/logo", name: "a.png", mime: "image/png", size: 2048 },
    });
    expect(screen.getByRole("img", { name: "a.png" }).getAttribute("src")).toBe("/api/docs/1/logo");
    expect(screen.getByRole("link", { name: "a.png" }).getAttribute("href")).toBe(
      "/api/docs/1/logo",
    );
    expect(screen.getByText("(2 kB)")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Remove file" }).getAttribute("name")).toBe(
      "logo:remove",
    );
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    expect(input?.accept).toBe("image/png");
  });

  it("previews a stored PDF in a details element", () => {
    const { container } = renderInput({
      removable: false,
      current: { url: "/api/docs/1/c", name: "c.pdf", mime: "application/pdf", size: 10 },
    });
    expect(container.querySelector("details summary")?.textContent).toBe("Preview");
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/api/docs/1/c");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows no preview for other types and no input when disabled", () => {
    const { container } = renderInput({
      disabled: true,
      current: { url: "/u", name: "a.txt", mime: "text/plain", size: 10 },
    });
    expect(container.querySelector("img, iframe")).toBeNull();
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("previews a chosen file and blocks files that are too large", () => {
    const create = vi.fn(() => "blob:preview");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const { container, unmount } = renderInput();
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const small = new File([new Uint8Array(10)], "small.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [small] } });
    expect(screen.getByRole("img", { name: "small.png" }).getAttribute("src")).toBe("blob:preview");
    expect(input.validationMessage).toBe("");
    const big = new File([new Uint8Array(2048)], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [big] } });
    expect(input.validationMessage).toBe("Choose a file of at most 1 kB");
    expect(screen.queryByRole("img")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:preview");
    fireEvent.change(input, { target: { files: [] } });
    unmount();
    vi.unstubAllGlobals();
  });
});

describe("file fields in forms", () => {
  const context = (files?: Record<string, string>) => ({
    components: {},
    relationOptions: {},
    labels: {},
    readOnly: false,
    serverFunction: vi.fn<AdminServerFunction>(),
    scope: formScope("docs", "1"),
    i18n: englishI18n,
    ...(files ? { files } : {}),
  });

  it("renders a file input with the stored file", () => {
    const { container } = render(
      <FieldInput field={contractField} value={stored} context={context({ contract: "/f" })} />,
    );
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    // A stored file is kept, so a new one is not required.
    expect(input?.required).toBe(false);
    expect(screen.getByRole("link", { name: "a.png" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("requires a file on create", () => {
    const { container } = render(
      <FieldInput field={contractField} value={null} context={context()} />,
    );
    expect(container.querySelector<HTMLInputElement>("input[type=file]")?.required).toBe(true);
    expect(container.querySelector("[data-field=contract]")?.className).toContain("col-span-6");
  });

  it("reads chosen files, removals and kept files", () => {
    const file = new File([new Uint8Array([1])], "a.png");
    const chosen = new FormData();
    chosen.append("logo", file);
    chosen.append("contract", new File([], ""));
    const parsed = parseFormData([logoField, contractField], chosen, englishI18n, "update");
    expect(parsed.data.logo).toBeInstanceOf(Blob);
    expect(parsed.data).not.toHaveProperty("contract");
    expect(parsed.errors).toEqual({});

    const removed = new FormData();
    removed.append("logo:remove", "on");
    removed.append("contract:remove", "on");
    const result = parseFormData([logoField, contractField], removed, englishI18n, "update");
    expect(result.data).toEqual({ logo: null });
    expect(result.errors).toEqual({ contract: "Required" });

    const empty = parseFormData([logoField, contractField], new FormData(), englishI18n, "create");
    expect(empty.data).toEqual({});
    expect(empty.errors).toEqual({ contract: "Required" });
  });
});

describe("file helpers", () => {
  it("builds download URLs for stored files", () => {
    const doc = { id: "a b", logo: stored, contract: null };
    expect(fileUrls("/api/", "my docs", doc, [logoField, contractField])).toEqual({
      logo: "/api/my%20docs/a%20b/logo",
    });
    expect(fileUrls("/api", "docs", null, [logoField])).toEqual({});
    expect(isStoredFile(stored)).toBe(true);
    expect(isStoredFile({ key: "k" })).toBe(false);
    expect(isStoredFile(null)).toBe(false);
  });

  it("formats sizes and cells, and never sorts files", () => {
    expect(formatBytes(englishI18n, 10)).toBe("1 kB");
    expect(formatBytes(englishI18n, 1536 * 1024)).toBe("1.5 MB");
    const meta = { fields: [logoField], admin: { useAsTitle: "id" } } as unknown as CollectionMeta;
    expect(formatCell(meta, "logo", { logo: stored }, new Map(), englishI18n)).toEqual({
      kind: "text",
      text: "a.png",
    });
    expect(formatCell(meta, "logo", { logo: { key: "k" } }, new Map(), englishI18n)).toEqual({
      kind: "text",
      text: "",
    });
    expect(isSortable(meta, "logo")).toBe(false);
  });
});

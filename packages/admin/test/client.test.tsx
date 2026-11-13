// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DeleteButton } from "../src/client/delete-button";
import { DocumentForm } from "../src/client/document-form";
import { JsonEditor } from "../src/client/json-editor";
import { RelationPicker } from "../src/client/relation-picker";
import { Badge, Button, ButtonLink, Card, CardBody, CardHeader, Toast } from "../src/ui";
import { FieldInput } from "../src/views/field-input";

import { router } from "./mocks";

import type { AdminResult, AdminServerFunction } from "../src";
import type { FieldMeta } from "@quickben/next";

function serverFunction(result: AdminResult) {
  return vi.fn<AdminServerFunction>(() => Promise.resolve(result));
}

const titleField: FieldMeta = {
  name: "title",
  type: "text",
  label: "Title",
  description: null,
  required: true,
  many: false,
  unique: false,
  admin: {},
};

function renderForm(fn: AdminServerFunction, id: string | null = null) {
  return render(
    <DocumentForm serverFunction={fn} basePath="/admin" slug="posts" id={id} submitLabel="Save">
      <FieldInput
        field={titleField}
        value="Hello"
        context={{
          components: {},
          relationOptions: {},
          labels: {},
          readOnly: false,
          serverFunction: fn,
        }}
      />
    </DocumentForm>,
  );
}

describe("DocumentForm", () => {
  it("saves and opens the document with a toast", async () => {
    const fn = serverFunction({ status: "ok", id: "p 1" });
    renderForm(fn);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/admin/posts/p%201?toast=created");
    });
    const request = fn.mock.calls[0]![0];
    expect(request).toMatchObject({ type: "save", slug: "posts", id: null });
    expect(request.type === "save" && request.formData.get("title")).toBe("Hello");
  });

  it("says saved when updating", async () => {
    renderForm(serverFunction({ status: "ok", id: "p1" }), "p1");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/admin/posts/p1?toast=saved");
    });
  });

  it("shows field errors, marks and focuses the field, and keeps the input", async () => {
    renderForm(
      serverFunction({
        status: "error",
        message: "Check the highlighted fields.",
        fieldErrors: { title: "Too long" },
      }),
    );
    const input = screen.getByLabelText<HTMLInputElement>(/Title/);
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Too long")).toBeTruthy();
    await waitFor(() => {
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Changed");
    expect(input.getAttribute("aria-describedby")).toBe("qb-field-title-hint qb-field-title-error");
  });

  it("ignores unexpected results", async () => {
    renderForm(serverFunction({ status: "options", options: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("DeleteButton", () => {
  it("asks for confirmation, then deletes and opens the list", async () => {
    const fn = serverFunction({ status: "ok", id: "p1" });
    render(
      <DeleteButton
        serverFunction={fn}
        basePath="/admin"
        slug="posts"
        id="p1"
        label="Post"
        title="Hello"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    expect(screen.getByText("Delete “Hello”? This cannot be undone.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/admin/posts?toast=deleted");
    });
    expect(fn).toHaveBeenCalledWith({ type: "delete", slug: "posts", id: "p1" });
  });

  it("shows errors", async () => {
    const fn = serverFunction({ status: "error", message: "Not allowed", fieldErrors: {} });
    render(
      <DeleteButton
        serverFunction={fn}
        basePath="/admin"
        slug="posts"
        id="p1"
        label="Post"
        title="Hello"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not allowed");
  });

  it("ignores unexpected results", async () => {
    const fn = serverFunction({ status: "options", options: [] });
    render(
      <DeleteButton
        serverFunction={fn}
        basePath="/admin"
        slug="posts"
        id="p1"
        label="Post"
        title="Hello"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(fn).toHaveBeenCalled();
    });
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("RelationPicker", () => {
  const options = [
    { id: "a1", label: "Ann" },
    { id: "a2", label: "Bob" },
  ];

  function hidden(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map(
      (input) => input.value,
    );
  }

  it("searches, picks with the keyboard and submits ids", async () => {
    const user = userEvent.setup();
    const fn = serverFunction({ status: "options", options });
    const { container } = render(
      <RelationPicker
        id="author"
        name="author"
        many={false}
        required
        disabled={false}
        describedBy=""
        initial={[]}
        serverFunction={fn}
        relatedSlug="authors"
        relatedLabel="Authors"
      />,
    );
    const input = screen.getByRole("combobox");
    expect((input as HTMLInputElement).required).toBe(true);
    await user.click(input);
    await user.type(input, "a");
    expect(await screen.findByRole("option", { name: "Bob" })).toBeTruthy();
    expect(fn).toHaveBeenLastCalledWith({ type: "search", slug: "authors", query: "a" });
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}");
    expect(hidden(container)).toEqual(["a2"]);
    expect(screen.queryByRole("combobox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove Bob" }));
    expect(hidden(container)).toEqual([]);
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("adds several values with the mouse and closes on Escape", async () => {
    const user = userEvent.setup();
    const fn = serverFunction({ status: "options", options });
    const { container } = render(
      <RelationPicker
        id="tags"
        name="tags"
        many
        required={false}
        disabled={false}
        describedBy=""
        initial={[{ id: "a1", label: "Ann" }]}
        serverFunction={fn}
        relatedSlug="tags"
        relatedLabel="Tags"
      />,
    );
    await user.click(screen.getByRole("combobox"));
    const bob = await screen.findByRole("option", { name: "Bob" });
    expect(screen.queryByRole("option", { name: "Ann" })).toBeNull();
    fireEvent.mouseDown(bob);
    expect(hidden(container)).toEqual(["a1", "a2"]);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("No matches")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows no matches when the search fails and hides controls when disabled", async () => {
    const user = userEvent.setup();
    const fn = vi.fn<AdminServerFunction>(() => Promise.reject(new Error("offline")));
    const { unmount } = render(
      <RelationPicker
        id="x"
        name="x"
        many
        required={false}
        disabled={false}
        describedBy=""
        initial={[]}
        serverFunction={fn}
        relatedSlug="tags"
        relatedLabel="Tags"
      />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("No matches")).toBeTruthy();
    fireEvent.blur(screen.getByRole("combobox"));
    unmount();
    render(
      <RelationPicker
        id="y"
        name="y"
        many
        required={false}
        disabled
        describedBy=""
        initial={[{ id: "a1", label: "Ann" }]}
        serverFunction={fn}
        relatedSlug="tags"
        relatedLabel="Tags"
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Ann" })).toBeNull();
  });
});

describe("JsonEditor", () => {
  it("validates while typing and formats valid JSON", () => {
    render(
      <JsonEditor
        id="meta"
        name="meta"
        defaultValue=""
        required={false}
        disabled={false}
        describedBy=""
      />,
    );
    const area = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(area, { target: { value: "{oops" } });
    expect(screen.getByText(/Invalid JSON/)).toBeTruthy();
    expect(area.validationMessage).toBe("Enter valid JSON");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Format" }).disabled).toBe(true);
    fireEvent.change(area, { target: { value: '{"a":1}' } });
    expect(screen.getByText("JSON")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(area.value).toBe('{\n  "a": 1\n}');
  });

  it("does nothing on format when empty and hides it when disabled", () => {
    const { unmount } = render(
      <JsonEditor
        id="m"
        name="m"
        defaultValue=""
        required={false}
        disabled={false}
        describedBy=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
    unmount();
    render(
      <JsonEditor id="n" name="n" defaultValue="1" required={false} disabled describedBy="" />,
    );
    expect(screen.queryByRole("button", { name: "Format" })).toBeNull();
  });
});

describe("Toast and kit", () => {
  it("removes its URL parameter, hides after a while and can be dismissed", () => {
    vi.useFakeTimers();
    globalThis.history.replaceState(null, "", "/admin/posts?toast=created&q=a");
    const { unmount } = render(<Toast message="Saved" param="toast" duration={1000} />);
    expect(screen.getByRole("status").textContent).toContain("Saved");
    expect(globalThis.location.search).toBe("?q=a");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    vi.useRealTimers();
    render(<Toast message="Failed" tone="error" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the component kit", () => {
    render(
      <Card>
        <CardHeader
          title="Title"
          description="Description"
          actions={<Button variant="ghost">Act</Button>}
        />
        <CardBody>
          <Badge tone="red">Red</Badge>
          <ButtonLink href="/x" variant="danger" size="sm">
            Go
          </ButtonLink>
        </CardBody>
      </Card>,
    );
    expect(screen.getByRole("button", { name: "Act" }).getAttribute("type")).toBe("button");
    expect(screen.getByRole("link", { name: "Go" }).getAttribute("href")).toBe("/x");
    expect(screen.getByText("Description")).toBeTruthy();
  });
});

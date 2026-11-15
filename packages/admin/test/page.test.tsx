// @vitest-environment happy-dom
import { getQuickben } from "@quickben/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createAdminPage,
  generateAdminMetadata,
  getAdminI18n,
  getAdminLocale,
  getAdminNav,
  navKeyForPath,
} from "../src";
import { createAdminContent } from "../src/page";

import { admin, editor, makeConfig } from "./fixtures";
import { actAs, incoming } from "./mocks";

import type { FieldComponentProps, PageProps, SearchParams, ViewProps } from "../src";
import type { ReactElement } from "react";

const system = { user: null, overrideAccess: true };
const config = makeConfig();
const ids: Record<string, string> = {};

function ColorInput({ name, id, value }: Readonly<FieldComponentProps>) {
  return (
    <input
      id={id}
      name={name}
      type="color"
      defaultValue={typeof value === "string" ? value : "#000000"}
    />
  );
}

function Reports({ segments, user }: Readonly<PageProps>) {
  return (
    <p>
      Reports {segments.join("/")} for {user?.id}
    </p>
  );
}

function OrgPicker({
  user,
  basePath,
}: Readonly<{ user: { id: string } | null; basePath: string }>) {
  return (
    <p>
      Org picker for {user?.id ?? "nobody"} at {basePath}
    </p>
  );
}

function TagBoard({ collection }: Readonly<ViewProps>) {
  return <p>Custom board of {collection.labels.plural}</p>;
}

function NoteEditor({ id }: Readonly<ViewProps>) {
  return <p>Custom note editor {id ?? "new"}</p>;
}

const Page = createAdminContent(config, {
  basePath: "/admin",
  components: { color: ColorInput },
  pages: [{ path: "reports", label: "Reports", component: Reports }],
  views: { tags: { list: TagBoard }, notes: { edit: NoteEditor } },
  signInHref: "/login",
  extensions: [{ sidebar: [OrgPicker] }],
});

async function renderPage(segments: string[] = [], searchParams: SearchParams = {}) {
  const element = await Page({
    params: Promise.resolve({ segments }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(element);
}

beforeAll(async () => {
  const qb = await getQuickben(config);
  const ann = await qb.create("authors", { name: "Ann" }, system);
  ids.ann = ann.id;
  const news = await qb.create("tags", { name: "news" }, system);
  for (let index = 1; index <= 12; index += 1) {
    const post = await qb.create(
      "posts",
      {
        title: `Post ${String(index).padStart(2, "0")}`,
        status: index % 2 === 0 ? "published" : "draft",
        featured: index === 1,
        author: ann.id,
        tags: [news.id],
        locked: "fixed",
        meta: { index },
      },
      system,
    );
    ids[`post${String(index)}`] = post.id;
  }
  await qb.create("notes", { text: "A note" }, system);
});

describe("dashboard and shell", () => {
  it("shows readable collections with counts and the user", async () => {
    actAs(editor);
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Test admin" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Admin" });
    expect(within(nav).getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).queryByRole("link", { name: "Secrets" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Logs" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Reports" }).getAttribute("href")).toBe(
      "/admin/reports",
    );
    const content = screen.getByRole("main");
    const posts = within(content).getByRole("link", { name: "Posts" }).closest("li")!;
    expect(within(posts).getByText("12")).toBeTruthy();
    expect(within(posts).getByRole("link", { name: "New post" })).toBeTruthy();
    expect(screen.getByText("e1")).toBeTruthy();
    expect(screen.getByText("editor")).toBeTruthy();
    expect(screen.getByText("Org picker for e1 at /admin")).toBeTruthy();
  });

  it("shows admin-only modules to admins", async () => {
    actAs(admin);
    await renderPage();
    const nav = screen.getByRole("navigation", { name: "Admin" });
    expect(within(nav).getByRole("link", { name: "Secrets" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: /Help/ }).getAttribute("target")).toBe("_blank");
  });

  it("asks anonymous users to sign in for collections they cannot read", async () => {
    actAs(null);
    await renderPage(["secrets"]);
    expect(screen.getByRole("heading", { name: "Sign in required" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByText("Not signed in")).toBeTruthy();
  });

  it("renders custom pages and 404s for unknown paths", async () => {
    actAs(editor);
    await renderPage(["reports", "2026"]);
    expect(screen.getByText("Reports 2026 for e1")).toBeTruthy();
    await expect(renderPage(["nope"])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a toast from the URL", async () => {
    actAs(editor);
    await renderPage(["posts"], { toast: "deleted" });
    expect(screen.getByRole("status").textContent).toContain("Post deleted");
  });
});

describe("list view", () => {
  it("lists documents with columns, badges and relation titles", async () => {
    actAs(editor);
    await renderPage(["posts"]);
    expect(screen.getByRole("heading", { level: 1, name: "Posts" })).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Title", "Status", "Author", "Featured", "Created"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(12);
    const first = rows[0]!;
    expect(within(first).getByRole("link", { name: "Post 12" }).getAttribute("href")).toBe(
      `/admin/posts/${ids.post12 ?? ""}`,
    );
    expect(within(first).getByText("published")).toBeTruthy();
    expect(within(first).getByText("Ann")).toBeTruthy();
    expect(within(first).getByText("No")).toBeTruthy();
    expect(screen.getByText("Showing 1–12 of 12")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New post" }).getAttribute("href")).toBe(
      "/admin/posts/new",
    );
  });

  it("filters, searches, sorts and paginates from the URL", async () => {
    actAs(editor);
    await renderPage(["posts"], {
      "filter.status": "draft",
      q: "post 0",
      sort: "title",
      limit: "10",
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Post 01",
      "Post 03",
      "Post 05",
      "Post 07",
      "Post 09",
    ]);
    const title = screen.getByRole("columnheader", { name: /Title/ });
    expect(title.getAttribute("aria-sort")).toBe("ascending");
    expect(within(title).getByRole("link").getAttribute("href")).toBe(
      "/admin/posts?q=post+0&filter.status=draft&sort=-title&limit=10",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Status").value).toBe("draft");
    expect(screen.getByLabelText<HTMLInputElement>("Search title").value).toBe("post 0");
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(
      "/admin/posts?sort=title&limit=10",
    );
  });

  it("links to the next and previous pages", async () => {
    actAs(editor);
    await renderPage(["posts"], { limit: "10", sort: "-title" });
    expect(screen.getByRole("link", { name: "Next →" }).getAttribute("href")).toBe(
      "/admin/posts?sort=-title&limit=10&page=2",
    );
    expect(screen.getByRole("columnheader", { name: /Title/ }).getAttribute("aria-sort")).toBe(
      "descending",
    );
    await renderPage(["posts"], { limit: "10", page: "2" });
    expect(screen.getAllByRole("link", { name: "← Previous" })[0]?.getAttribute("href")).toBe(
      "/admin/posts?limit=10",
    );
  });

  it("shows an empty state and hides create without access", async () => {
    actAs(null);
    await renderPage(["posts"], { q: "nothing matches" });
    expect(screen.getByText("No posts found.")).toBeTruthy();
    expect(screen.getByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New post" })).toBeNull();
  });

  it("renders custom list views", async () => {
    actAs(editor);
    await renderPage(["tags"]);
    expect(screen.getByText("Custom board of Tags")).toBeTruthy();
  });

  it("lists collections without a searchable title", async () => {
    actAs(admin);
    await renderPage(["secrets"]);
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.getByText("No secrets found.")).toBeTruthy();
  });
});

describe("edit view", () => {
  it("renders an empty create form with defaults", async () => {
    actAs(editor);
    await renderPage(["posts", "new"]);
    expect(screen.getByRole("heading", { level: 1, name: "New post" })).toBeTruthy();
    const title = screen.getByLabelText<HTMLInputElement>(/^Title/);
    expect(title.required).toBe(true);
    expect(title.maxLength).toBe(80);
    expect(screen.getByLabelText<HTMLSelectElement>(/^Status/).value).toBe("draft");
    expect(screen.getByLabelText<HTMLInputElement>("Views").step).toBe("1");
    expect(screen.getByLabelText<HTMLInputElement>("Published at").type).toBe("datetime-local");
    expect(screen.getByText("Time in UTC.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Published on").type).toBe("date");
    expect(screen.getByLabelText<HTMLInputElement>("Contact").type).toBe("email");
    expect(screen.getByLabelText<HTMLInputElement>("Website").type).toBe("url");
    expect(screen.getByLabelText("Summary").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText<HTMLInputElement>("Color").type).toBe("color");
    expect(screen.getByRole("group", { name: "Channels" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Author" })).toBeTruthy();
    expect(screen.queryByLabelText("Internal")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Locked").disabled).toBe(true);
    expect(screen.getByText("URL part.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create post" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("fills the edit form and shows details and delete for admins", async () => {
    actAs(admin);
    await renderPage(["posts", ids.post1 ?? ""]);
    expect(screen.getByRole("heading", { level: 1, name: "Post 01" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe("Post 01");
    expect(screen.getByLabelText<HTMLInputElement>("Featured").checked).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Meta").value).toContain('"index": 1');
    expect(screen.getByLabelText<HTMLInputElement>("Locked").value).toBe("fixed");
    expect(screen.getByRole("list", { name: "Selected authors" }).textContent).toContain("Ann");
    expect(screen.getByRole("list", { name: "Selected tags" }).textContent).toContain("news");
    expect(screen.getByText(ids.post1 ?? "")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete post" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("is read-only without update access", async () => {
    actAs(null);
    await renderPage(["posts", ids.post2 ?? ""]);
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).disabled).toBe(true);
  });

  it("returns 404 for missing or hidden documents", async () => {
    actAs(null);
    await expect(renderPage(["posts", ids.post1 ?? ""])).rejects.toThrow("NEXT_NOT_FOUND");
    actAs(editor);
    await expect(renderPage(["posts", "missing"])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows access errors inside the shell", async () => {
    const qb = await getQuickben(config);
    const note = await qb.find("notes", {}, system);
    actAs(editor);
    await renderPage(["notes"]);
    await renderPage(["authors", "new"]);
    expect(screen.getByRole("button", { name: "Create author" })).toBeTruthy();
    const view = await renderPage(["notes", note.docs[0]?.id ?? ""]);
    expect(view.getByText("Custom note editor " + (note.docs[0]?.id ?? ""))).toBeTruthy();
    cleanup();
    const Plain = createAdminContent(config, { basePath: "/plain/" });
    render(
      await Plain({
        params: Promise.resolve({ segments: ["notes", note.docs[0]?.id ?? ""] }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.getByText('Not allowed to read in "notes"')).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/plain");
  });
});

describe("createAdminPage", () => {
  it("renders the content inside Suspense", () => {
    const AdminPage = createAdminPage(config);
    const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };
    const element = AdminPage(props);
    expect(element.type).toBe(Suspense);
    const { fallback, children } = element.props as {
      fallback: ReactElement;
      children: ReactElement<typeof props>;
    };
    expect(render(fallback).container.firstElementChild?.className).toContain("qb-root");
    expect(children.props).toEqual(props);
  });
});

describe("generateAdminMetadata", () => {
  it("defaults the title to the admin title and turns off indexing", () => {
    expect(generateAdminMetadata(config)).toEqual({
      title: { absolute: "Admin · Test admin" },
      robots: { index: false, follow: false },
    });
  });

  it("translates the default title", () => {
    expect(generateAdminMetadata(config, { locale: "es" }).title).toEqual({
      absolute: "Administración · Test admin",
    });
    const localized = {
      ...config,
      admin: {
        title: { en: "Office", es: "Oficina" },
        locale: "es",
        meta: { description: { en: "Ops", es: "Operaciones" } },
      },
    };
    expect(generateAdminMetadata(localized)).toMatchObject({
      title: { absolute: "Administración · Oficina" },
      description: "Operaciones",
    });
  });

  it("uses admin.meta", () => {
    const custom = {
      ...config,
      admin: { title: "App", meta: { title: "Back office", description: "Ops" } },
    };
    expect(generateAdminMetadata(custom)).toMatchObject({
      title: { absolute: "Back office" },
      description: "Ops",
    });
  });
});

describe("Spanish", () => {
  const Spanish = createAdminContent(config, {
    basePath: "/es",
    locale: "es",
    messages: { es: { "admin.nav.pages": "Hojas" } },
    pages: [
      {
        path: "reports",
        label: { en: "Reports", es: "Informes" },
        group: (i18n) => (i18n.locale === "es" ? "Análisis" : "Analysis"),
        component: Reports,
      },
    ],
  });
  const renderEs = async (segments: string[] = [], searchParams: SearchParams = {}) =>
    render(
      await Spanish({
        params: Promise.resolve({ segments }),
        searchParams: Promise.resolve(searchParams),
      }),
    );

  it("renders the shell, dashboard and list in Spanish", async () => {
    actAs(admin);
    const view = await renderEs();
    expect(view.container.querySelector(".qb-root")?.getAttribute("lang")).toBe("es");
    const nav = screen.getByRole("navigation", { name: "Administración" });
    expect(within(nav).getByRole("link", { name: "Panel" })).toBeTruthy();
    expect(within(nav).getByText("Análisis")).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Informes" })).toBeTruthy();
    expect(screen.getByText("Colecciones a las que tienes acceso.")).toBeTruthy();
    cleanup();
    await renderEs(["posts"], { toast: "deleted" });
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeTruthy();
    expect(screen.getByText(/^Mostrando 1–12 de 12$/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Post: registro eliminado");
  });

  it("renders the edit form in Spanish", async () => {
    actAs(admin);
    await renderEs(["posts", ids.post1 ?? ""]);
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Ruta de navegación" })).toBeTruthy();
    expect(screen.getByText("Detalles")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eliminar post" })).toBeTruthy();
  });
});

describe("embedded mode", () => {
  const Embedded = createAdminContent(config, { basePath: "/app/data", chrome: "none" });

  it("renders only the page, without sidebar", async () => {
    actAs(editor);
    const view = render(
      await Embedded({
        params: Promise.resolve({ segments: ["posts"] }),
        searchParams: Promise.resolve({ toast: "saved" }),
      }),
    );
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
    expect(view.container.firstElementChild?.className).toBe("qb-root");
    expect(screen.getByRole("heading", { level: 1, name: "Posts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New post" }).getAttribute("href")).toBe(
      "/app/data/posts/new",
    );
    expect(screen.getByRole("status").textContent).toContain("Changes saved");
  });

  it("uses a plain fallback", () => {
    const AdminPage = createAdminPage(config, { chrome: "none" });
    const element = AdminPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
    const { fallback } = element.props as { fallback: ReactElement };
    expect(render(fallback).container.firstElementChild?.className).toBe("qb-root");
  });
});

describe("getAdminNav", () => {
  const options = {
    basePath: "/app/data",
    pages: [{ path: "reports", label: "Reports", component: Reports }],
  };

  it("gives the nav model with the active link", async () => {
    actAs(editor);
    const nav = await getAdminNav(config, options, { pathname: "/app/data/posts/abc" });
    expect(nav.title).toBe("Test admin");
    expect(nav.current).toBe("posts");
    expect(nav.dashboard).toEqual({
      label: "Dashboard",
      href: "/app/data",
      key: "",
      external: false,
      active: false,
    });
    const links = nav.groups.flatMap((group) => group.links);
    expect(links.find((link) => link.key === "posts")?.active).toBe(true);
    expect(links.find((link) => link.key === "reports")).toMatchObject({
      href: "/app/data/reports",
      active: false,
    });
    expect(links.some((link) => link.key === "secrets")).toBe(false);
  });

  it("marks the dashboard and ignores paths outside the admin", async () => {
    actAs(editor);
    expect((await getAdminNav(config, options, { pathname: "/app/data/" })).dashboard.active).toBe(
      true,
    );
    const outside = await getAdminNav(config, options, { pathname: "/elsewhere" });
    expect(outside.current).toBeNull();
    expect(outside.dashboard.active).toBe(false);
    expect((await getAdminNav(config)).basePath).toBe("/admin");
    expect(navKeyForPath("/admin/r%C3%A9", "/admin")).toBe("ré");
  });

  it("resolves the locale and translator of the request", async () => {
    incoming.set("accept-language", "es-CL,es;q=0.9");
    const fromHeader = {
      locale: (req: Request | undefined) => req?.headers.get("accept-language")?.slice(0, 5),
    };
    expect(await getAdminLocale(config, fromHeader)).toBe("es-CL");
    expect((await getAdminI18n(config, fromHeader)).t("nav.dashboard")).toBe("Panel");
    expect(await getAdminLocale(config)).toBe("en");
    incoming.delete("accept-language");
  });
});

import { defineCollection, defineConfig, definePlugin, fields as f } from "@quickben/core";
import { connections } from "@quickben/plugin-connections";
import { templates, TEMPLATE_COLLECTIONS } from "@quickben/plugin-templates";
import { tenancy } from "@quickben/plugin-tenancy";

import { playgroundAuth } from "./lib/auth";
import { connectionsEnabled, demoMasterKey } from "./lib/connections";
import { createDb } from "./lib/db";
import { docReaderEnabled, playgroundDocReader } from "./lib/doc-reader";
import { playgroundLocale } from "./lib/locale";
import { seedIfEmpty } from "./lib/seed";
import { invoice, templatesEnabled } from "./lib/templates";
import { tenancyEnabled } from "./lib/tenancy";

import type { AccessArgs } from "@quickben/core";

const hasRole =
  (...roles: string[]) =>
  ({ user }: AccessArgs) =>
    user?.roles?.some((role) => roles.includes(role)) ?? false;

const canEdit = hasRole("admin", "editor");
const isAdmin = hasRole("admin");

export const authors = defineCollection({
  slug: "authors",
  labels: {
    singular: { en: "Author", es: "Autor" },
    plural: { en: "Authors", es: "Autores" },
  },
  fields: {
    name: f.text({ required: true, maxLength: 120, label: { en: "Name", es: "Nombre" } }),
    // Field access: viewers cannot read emails; only admins change `active`.
    email: f.email({
      unique: true,
      label: { en: "Email", es: "Correo" },
      access: { read: canEdit },
    }),
    bio: f.textarea({ maxLength: 2000, label: { en: "Bio", es: "Biografía" } }),
    active: f.boolean({
      default: true,
      label: { en: "Active", es: "Activo" },
      access: { create: isAdmin, update: isAdmin },
    }),
  },
  access: { read: () => true, create: canEdit, update: canEdit, delete: isAdmin },
  admin: { useAsTitle: "name", defaultColumns: ["name", "email", "active", "updatedAt"] },
});

export const tags = defineCollection({
  slug: "tags",
  labels: { singular: { en: "Tag", es: "Etiqueta" }, plural: { en: "Tags", es: "Etiquetas" } },
  fields: {
    name: f.text({
      required: true,
      unique: true,
      maxLength: 60,
      label: { en: "Name", es: "Nombre" },
    }),
    color: f.select({
      options: ["gray", "blue", "green", "amber", "red"],
      default: "gray",
      label: { en: "Color", es: "Color" },
    }),
  },
  access: { read: () => true, create: canEdit, update: canEdit, delete: canEdit },
  admin: { useAsTitle: "name" },
});

export const posts = defineCollection({
  slug: "posts",
  labels: {
    singular: { en: "Post", es: "Publicación" },
    plural: { en: "Posts", es: "Publicaciones" },
  },
  fields: {
    title: f.text({ required: true, maxLength: 200, label: { en: "Title", es: "Título" } }),
    slug: f.text({
      unique: true,
      maxLength: 200,
      label: { en: "Slug", es: "Slug" },
      description: {
        en: "Lowercase letters, digits and dashes.",
        es: "Minúsculas, dígitos y guiones.",
      },
      validate: (value) =>
        /^[a-z\d]+(?:-[a-z\d]+)*$/.test(value) || "Use lowercase letters, digits and dashes",
      admin: { width: "half" },
    }),
    status: f.select({
      options: ["draft", "review", "published"],
      required: true,
      default: "draft",
      label: { en: "Status", es: "Estado" },
      admin: { width: "third" },
    }),
    author: f.relation({
      to: "authors",
      label: { en: "Author", es: "Autor" },
      admin: { width: "third" },
    }),
    publishedAt: f.datetime({
      label: { en: "Published at", es: "Publicado el" },
      admin: { width: "third" },
    }),
    tags: f.relation({ to: "tags", many: true, label: { en: "Tags", es: "Etiquetas" } }),
    featured: f.boolean({ default: false, label: { en: "Featured", es: "Destacado" } }),
    body: f.textarea({ label: { en: "Body", es: "Contenido" } }),
  },
  access: {
    // Anonymous visitors see published posts only.
    read: ({ user }) => (user ? true : { status: { eq: "published" as const } }),
    create: canEdit,
    update: canEdit,
    delete: isAdmin,
  },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "status", "author", "tags", "publishedAt"],
    description: {
      en: "Articles shown on the public page once published.",
      es: "Artículos que aparecen en la página pública una vez publicados.",
    },
  },
});

export const settings = defineCollection({
  slug: "settings",
  labels: {
    singular: { en: "Setting", es: "Ajuste" },
    plural: { en: "Settings", es: "Ajustes" },
  },
  fields: {
    key: f.text({ required: true, unique: true, label: { en: "Key", es: "Clave" } }),
    value: f.json({
      required: true,
      label: { en: "Value", es: "Valor" },
      description: { en: "Any JSON value.", es: "Cualquier valor JSON." },
    }),
    description: f.text({ label: { en: "Description", es: "Descripción" } }),
  },
  access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
  admin: { useAsTitle: "key", defaultColumns: ["key", "value", "description"] },
});

const demo = definePlugin({
  name: "playground",
  modules: [
    {
      key: "content",
      label: { en: "Content", es: "Contenido" },
      collections: ["posts", "authors", "tags"],
    },
    { key: "system", label: { en: "System", es: "Sistema" }, collections: ["settings"] },
  ],
  onInit: seedIfEmpty,
});

// With QUICKBEN_TEMPLATES=1: document templates and a brand (per organization with tenancy).
const documentTemplates = templates({
  kinds: [invoice],
  access: { manage: hasRole("admin", "editor") },
});

// With QUICKBEN_TENANCY=1, posts, authors and tags belong to an organization. The demo `admin`
// user is platform staff: it sees every organization.
const multiTenant = tenancy({
  scope: ["posts", "authors", "tags", ...(templatesEnabled ? TEMPLATE_COLLECTIONS : [])],
  isPlatformAdmin: (user) => user.roles?.includes("admin") === true,
});

// Fields the host adds to the tenancy collections. They show in the Organization settings page
// and the member details dialog. Only platform staff change the plan. The contact email is
// edited in the custom "Contact" settings section (lib/tenancy-sections.tsx), so it is hidden
// from the generic form.
const isStaff = hasRole("admin");
const tenancyFields = definePlugin({
  name: "playground-tenancy-fields",
  addFields: {
    organizations: {
      plan: f.select({
        options: ["free", "pro"],
        default: "free",
        label: { en: "Plan", es: "Plan" },
        access: { create: isStaff, update: isStaff },
      }),
      contactEmail: f.email({
        label: { en: "Contact email", es: "Correo de contacto" },
        admin: { hidden: true },
      }),
    },
    memberships: {
      jobTitle: f.text({ maxLength: 80, label: { en: "Job title", es: "Cargo" } }),
    },
  },
});

// With QUICKBEN_CONNECTIONS=1, the admin gets Integrations: connections and credentials.
const integrations = connections({ masterKey: demoMasterKey });

const config = defineConfig({
  db: createDb(),
  collections: [authors, tags, posts, settings],
  plugins: [
    demo,
    // With QUICKBEN_DOC_READER=1: document types, readings and usage, with a fake model.
    ...(docReaderEnabled ? [playgroundDocReader] : []),
    ...(templatesEnabled ? [documentTemplates] : []),
    ...(tenancyEnabled ? [multiTenant, tenancyFields] : []),
    ...(connectionsEnabled ? [integrations] : []),
  ],
  auth: playgroundAuth(),
  // QUICKBEN_LOCALE=es shows the admin in Spanish; otherwise cookie, Accept-Language, English.
  admin: { title: "Quickben Playground", locale: playgroundLocale },
});

export default config;

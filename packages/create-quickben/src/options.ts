/** Databases the CLI can set up. */
export const databases = ["pglite", "postgres", "sqlite", "memory"] as const;
export type Database = (typeof databases)[number];

/** Package managers the CLI can install with. */
export const packageManagers = ["pnpm", "npm", "yarn", "bun"] as const;
export type PackageManager = (typeof packageManagers)[number];

/** Starter content. */
export const examples = ["blank", "blog"] as const;
export type Example = (typeof examples)[number];

/** Everything needed to create a project. */
export interface ProjectOptions {
  /** Absolute path of the new project. */
  directory: string;
  /** Package name, from the directory name. */
  name: string;
  db: Database;
  pm: PackageManager;
  example: Example;
  install: boolean;
  git: boolean;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint: string;
}

export const databaseChoices: readonly Choice<Database>[] = [
  { value: "pglite", label: "PGlite", hint: "Postgres in process, no server. Data in ./.pglite" },
  { value: "postgres", label: "Postgres", hint: "A Postgres server, set DATABASE_URL" },
  { value: "sqlite", label: "SQLite", hint: "libSQL, a local file or a Turso server" },
  { value: "memory", label: "In memory", hint: "Resets on restart. For demos and tests" },
];

export const exampleChoices: readonly Choice<Example>[] = [
  { value: "blank", label: "Blank", hint: "One collection (notes)" },
  { value: "blog", label: "Blog", hint: "Authors and posts, roles, demo data" },
];

/** Defaults used with `--yes` or without a terminal. */
export const defaults = {
  directory: "quickben-app",
  db: "pglite",
  example: "blank",
  install: true,
  git: true,
} as const satisfies Partial<Record<keyof ProjectOptions, unknown>>;

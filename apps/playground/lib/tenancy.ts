/**
 * Multi-tenancy demo switch. Start the playground with `QUICKBEN_TENANCY=1` to add
 * `@quickben/plugin-tenancy`: posts, authors and tags then belong to an organization, and the
 * admin gets an organization switcher, a Members page and an Organization settings page.
 */
export const tenancyEnabled = process.env.QUICKBEN_TENANCY === "1";

/** Demo organizations and the role of each demo user in them. */
export const demoOrganizations = [
  {
    name: "Acme",
    slug: "acme",
    members: [
      { user: "editor", email: "editor@example.com", role: "owner" },
      { user: "viewer", email: "viewer@example.com", role: "viewer" },
    ],
  },
  {
    name: "Globex",
    slug: "globex",
    members: [{ user: "editor", email: "editor@example.com", role: "admin" }],
  },
] as const;

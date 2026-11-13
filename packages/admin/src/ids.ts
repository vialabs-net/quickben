/**
 * Scope of the control ids of one form. Ids must be unique per document: with
 * `cacheComponents`, Next.js keeps recently visited pages mounted but hidden, so the create
 * form and the edit form of a collection can be in the DOM at the same time.
 */
export function formScope(slug: string, id: string | null): string {
  return `${slug}-${id === null ? "new" : id.replaceAll(/[^\w-]/g, "_")}`;
}

/** Id of the main control of a field. Labels, hints and errors derive their ids from it. */
export function controlId(scope: string, name: string): string {
  return `qb-${scope}-${name}`;
}

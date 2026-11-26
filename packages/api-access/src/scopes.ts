/** Scope that grants every other scope. */
export const ALL_SCOPES = "*";

/** True when `granted` has every scope in `required` (exact match), or has `"*"`. */
export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
  return missingScopes(granted, required).length === 0;
}

/** Scopes in `required` that `granted` lacks, without duplicates. Empty when `granted` has `"*"`. */
export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const have = new Set(granted);
  if (have.has(ALL_SCOPES)) return [];
  return [...new Set(required)].filter((scope) => !have.has(scope));
}

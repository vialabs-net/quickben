/** `admin/` → `/admin`. */
export function normalizeBasePath(basePath: string): string {
  let end = basePath.length;
  while (end > 0 && basePath[end - 1] === "/") end -= 1;
  const trimmed = basePath.slice(0, end);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

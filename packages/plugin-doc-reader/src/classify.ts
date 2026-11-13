import type { DocumentType } from "./definition";

const regex = (pattern: string) => new RegExp(pattern, "iu");

/**
 * Pick the type whose hints match: text first (the first page is enough), then the file name.
 * Used when a caller asks for type `"auto"`.
 */
export function classifyType(
  types: readonly DocumentType[],
  fileName: string,
  text: string | null,
): DocumentType | null {
  const body = text?.replaceAll(/\s+/gu, " ").slice(0, 4000);
  if (body) {
    const byText = types.find((type) =>
      type.classification.text.some((pattern) => regex(pattern).test(body)),
    );
    if (byText) return byText;
  }
  const name = fileName.replace(/\.[a-z\d]+$/iu, "");
  return (
    types.find((type) =>
      type.classification.fileName.some((pattern) => regex(pattern).test(name)),
    ) ?? null
  );
}

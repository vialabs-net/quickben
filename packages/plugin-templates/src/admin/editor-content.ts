import { getTemplateKind } from "../service";

import type { TemplateContent } from "../content";
import type { TemplateDetail } from "../service";
import type { Quickben } from "@quickben/core";

/** The content the editor starts with: the draft, the published version or the base template. */
export function editorContent(qb: Quickben, detail: TemplateDetail): TemplateContent | null {
  return (
    detail.draft?.content ??
    detail.published?.content ??
    getTemplateKind(qb, detail.kind).baseTemplate ??
    null
  );
}

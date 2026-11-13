/**
 * Extraction templates: how to read fields out of one document format's text.
 *
 * Templates are data, not code. `match` says whether a document is in this format; each field
 * lists alternative rules and the first that matches wins. `applyTemplate` is the only code.
 * Values are normalized afterwards by the field's type, so a rule only captures.
 */
import { z } from "zod";

import { isValidPattern } from "./definition";

const pattern = z.string().min(1).max(1000).refine(isValidPattern, "invalid regular expression");

export const fieldRuleSchema = z.object({
  /** Regular expression over the document's text, whitespace collapsed to single spaces. */
  pattern,
  /** Capture group with the value. Default 1. */
  group: z.number().int().min(0).max(20).optional(),
});
export type FieldRule = z.infer<typeof fieldRuleSchema>;

export const templateSchema = z.object({
  /** Every pattern must match for the document to be in this format. */
  match: z.array(pattern).default([]),
  /** Rules per field key, tried in order. */
  fields: z.record(z.string(), z.array(fieldRuleSchema).min(1)),
});
export type ExtractionTemplate = z.input<typeof templateSchema>;

/** Values a template captured, or `null` when the text is not in its format. */
export function applyTemplate(
  template: ExtractionTemplate,
  rawText: string,
): Record<string, string> | null {
  const text = rawText.replaceAll(/\s+/gu, " ");
  if (!(template.match ?? []).every((p) => new RegExp(p, "iu").test(text))) return null;

  const fields: Record<string, string> = {};
  for (const [name, rules] of Object.entries(template.fields)) {
    for (const rule of rules) {
      const value = new RegExp(rule.pattern, "iu").exec(text)?.[rule.group ?? 1]?.trim();
      if (value) {
        fields[name] = value;
        break;
      }
    }
  }
  return fields;
}

import { QuickbenError } from "@quickben/core";

/** Why a studio action was refused. */
export type StudioRule =
  | "type-exists"
  | "draft-exists"
  | "published"
  | "not-tested"
  | "no-samples"
  | "changed"
  /** The type is split already: pass `resplit: true`. */
  | "split-exists"
  /** `test` and `unseen` run only when publishing, or with `heldOut: true`. */
  | "held-out"
  /** The draft has no finished `validation` run of its current revision. */
  | "not-validated"
  /** The published version has no finished `validation` run of the same split version. */
  | "no-baseline"
  /** The draft is worse than the published version beyond the type's thresholds. */
  | "gate";

/** A studio action conflicts with the current state, e.g. editing a published version. */
export class StudioError extends QuickbenError {
  readonly rule: StudioRule;
  /** Why the publish gate refused, one line per failed check. */
  readonly reasons: readonly string[];

  constructor(rule: StudioRule, message: string, reasons: readonly string[] = []) {
    super("CONFLICT", message);
    this.name = "StudioError";
    this.rule = rule;
    this.reasons = reasons;
  }
}

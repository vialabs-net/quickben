/** Result of a form server action. */
export type FormState =
  | { status: "idle" }
  | {
      status: "error";
      /** Message for the whole form. */
      message: string;
      /** First error message per field name. */
      fieldErrors: Record<string, string>;
    };

/** A failed submit. */
export type ErrorState = Extract<FormState, { status: "error" }>;

/** State before the first submit. */
export const idleState: FormState = { status: "idle" };

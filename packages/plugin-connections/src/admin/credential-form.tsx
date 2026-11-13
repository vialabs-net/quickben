"use client";

import { Input, Select, Textarea } from "@quickben/admin/ui";
import { useState } from "react";

import { ActionForm, FormField } from "./form";
import { maskedSecret } from "./state";

import type { CredentialKind } from "../provider";
import type { FormState } from "./state";
import type { ReactNode } from "react";

/** Props of {@link CredentialForm}. */
export interface CredentialFormProps {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  kinds: readonly { kind: CredentialKind; label: string }[];
  values: { name: string; kind: CredentialKind };
  /** `null` on create. */
  stored: { hasSecret: boolean; last4: string | null } | null;
  submitLabel: string;
  readOnly: boolean;
  secondary?: ReactNode;
}

const placeholders: Record<CredentialKind, string> = {
  api_key: "sk-…",
  service_account_json: '{ "type": "service_account", … }',
  basic: "username:password",
};

/** Create or edit form of a credential. The secret is write-only. */
export function CredentialForm({
  action,
  kinds,
  values,
  stored,
  submitLabel,
  readOnly,
  secondary,
}: Readonly<CredentialFormProps>) {
  const scope = "qb-credential";
  const [kind, setKind] = useState<CredentialKind>(values.kind);
  const secretHint = stored
    ? `${maskedSecret(stored)}. Leave it empty to keep it; it is never shown again.`
    : "Encrypted when saved and never shown again.";
  return (
    <ActionForm
      action={action}
      scope={scope}
      submitLabel={submitLabel}
      readOnly={readOnly}
      secondary={secondary}
    >
      <div className="qb:grid qb:grid-cols-1 qb:gap-x-5 qb:gap-y-5 qb:md:grid-cols-6">
        <FormField scope={scope} name="name" label="Name" required>
          {(control) => (
            <Input
              id={control.id}
              name="name"
              defaultValue={values.name}
              required
              maxLength={120}
              disabled={readOnly}
              aria-describedby={control.describedBy}
            />
          )}
        </FormField>
        <FormField scope={scope} name="kind" label="Kind" required>
          {(control) => (
            <Select
              id={control.id}
              name="kind"
              value={kind}
              onChange={(event) => {
                setKind(event.currentTarget.value as CredentialKind);
              }}
              disabled={readOnly}
              aria-describedby={control.describedBy}
            >
              {kinds.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField
          scope={scope}
          name="secret"
          label={stored ? "Replace secret" : "Secret"}
          required={!stored}
          hint={secretHint}
          span="full"
        >
          {(control) =>
            kind === "service_account_json" ? (
              <Textarea
                id={control.id}
                name="secret"
                placeholder={placeholders[kind]}
                disabled={readOnly}
                autoComplete="off"
                spellCheck={false}
                className="qb:font-mono qb:text-xs"
                aria-describedby={control.describedBy}
              />
            ) : (
              <Input
                id={control.id}
                name="secret"
                type="password"
                placeholder={placeholders[kind]}
                disabled={readOnly}
                autoComplete="new-password"
                aria-describedby={control.describedBy}
              />
            )
          }
        </FormField>
      </div>
    </ActionForm>
  );
}

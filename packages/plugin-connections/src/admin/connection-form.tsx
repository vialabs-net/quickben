"use client";

import { useAdminI18n } from "@quickben/admin/i18n";
import { Checkbox, Input, Select, Textarea } from "@quickben/admin/ui";

import { ActionForm, FormField } from "./form";
import { connectionsMessages } from "./messages";

import type { FieldView, ProviderView } from "./describe";
import type { FormState } from "./state";
import type { ReactNode } from "react";

/** Current values of a connection form. */
export interface ConnectionValues {
  name: string;
  baseUrl: string | null;
  credential: string | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

/** Props of {@link ConnectionForm}. */
export interface ConnectionFormProps {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  provider: ProviderView;
  values: ConnectionValues;
  /** Credentials of a kind the provider takes. */
  credentials: readonly { id: string; label: string }[];
  /** Link to create a credential. */
  newCredentialHref: string;
  submitLabel: string;
  readOnly: boolean;
  secondary?: ReactNode;
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function MetadataControl({
  field,
  value,
  id,
  describedBy,
  disabled,
}: Readonly<{
  field: FieldView;
  value: unknown;
  id: string;
  describedBy: string;
  disabled: boolean;
}>) {
  const i18n = useAdminI18n();
  const name = `metadata.${field.key}`;
  const current = value === undefined ? field.default : value;
  switch (field.control) {
    case "checkbox":
      return (
        <Checkbox
          id={id}
          name={name}
          defaultChecked={current === true}
          disabled={disabled}
          aria-describedby={describedBy}
        />
      );
    case "select":
      return (
        <Select
          id={id}
          name={name}
          defaultValue={textValue(current)}
          disabled={disabled}
          aria-describedby={describedBy}
        >
          {field.required ? null : <option value="">{i18n.t("value.empty")}</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "json":
      return (
        <Textarea
          id={id}
          name={name}
          defaultValue={textValue(current)}
          disabled={disabled}
          aria-describedby={describedBy}
          className="qb:font-mono qb:text-xs"
          spellCheck={false}
        />
      );
    default:
      return (
        <Input
          id={id}
          name={name}
          type={field.control === "number" ? "number" : "text"}
          defaultValue={textValue(current)}
          placeholder={field.placeholder ?? undefined}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          disabled={disabled}
          aria-describedby={describedBy}
        />
      );
  }
}

/** Create or edit form of a connection: name, URL, credential, enabled and provider settings. */
export function ConnectionForm({
  action,
  provider,
  values,
  credentials,
  newCredentialHref,
  submitLabel,
  readOnly,
  secondary,
}: Readonly<ConnectionFormProps>) {
  const { t } = useAdminI18n().scope(connectionsMessages);
  const scope = "qb-connection";
  return (
    <ActionForm
      action={action}
      scope={scope}
      submitLabel={submitLabel}
      readOnly={readOnly}
      secondary={secondary}
    >
      <div className="qb:grid qb:grid-cols-1 qb:gap-x-5 qb:gap-y-5 qb:md:grid-cols-6">
        <FormField scope={scope} name="name" label={t("field.name")} required>
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
        <FormField
          scope={scope}
          name="baseUrl"
          label={t("field.baseUrl")}
          required={provider.baseUrl.required}
          hint={provider.baseUrl.required ? null : t("field.baseUrlHint")}
        >
          {(control) => (
            <Input
              id={control.id}
              name="baseUrl"
              type="url"
              defaultValue={values.baseUrl ?? ""}
              placeholder={provider.baseUrl.placeholder ?? undefined}
              disabled={readOnly}
              aria-describedby={control.describedBy}
            />
          )}
        </FormField>
        <FormField
          scope={scope}
          name="credential"
          label={t("field.credential")}
          required={provider.credential.required}
          hint={credentials.length === 0 ? t("field.noCredential") : null}
        >
          {(control) => (
            <div className="qb:flex qb:items-center qb:gap-2">
              <Select
                id={control.id}
                name="credential"
                defaultValue={values.credential ?? ""}
                disabled={readOnly}
                aria-describedby={control.describedBy}
              >
                <option value="">
                  {provider.credential.required ? t("field.choose") : t("field.none")}
                </option>
                {credentials.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.label}
                  </option>
                ))}
              </Select>
              {readOnly ? null : (
                <a
                  href={newCredentialHref}
                  className="qb:text-sm qb:whitespace-nowrap qb:text-fg qb:hover:underline"
                >
                  {t("field.newCredential")}
                </a>
              )}
            </div>
          )}
        </FormField>
        <div className="qb:flex qb:items-end qb:md:col-span-3">
          <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm qb:font-medium qb:text-fg">
            <Checkbox name="enabled" defaultChecked={values.enabled} disabled={readOnly} />
            {t("field.enabled")}
          </label>
        </div>
        {provider.fields.map((field) => (
          <FormField
            key={field.key}
            scope={scope}
            name={`metadata.${field.key}`}
            label={field.label}
            required={field.required}
            hint={field.description}
            span={field.control === "json" ? "full" : "half"}
          >
            {(control) => (
              <MetadataControl
                field={field}
                value={values.metadata[field.key]}
                id={control.id}
                describedBy={control.describedBy}
                disabled={readOnly}
              />
            )}
          </FormField>
        ))}
      </div>
    </ActionForm>
  );
}

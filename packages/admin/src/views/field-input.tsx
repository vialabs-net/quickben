import { FieldError } from "../client/document-form";
import { JsonEditor } from "../client/json-editor";
import { RelationPicker } from "../client/relation-picker";
import { toDatetimeLocal, toJsonText } from "../form-data";
import { controlId } from "../ids";
import { cn } from "../ui/cn";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "../ui/input";

import type { AdminServerFunction, FieldComponentProps, RelationOption } from "../types";
import type { FieldMeta } from "@quickben/next";
import type { ComponentType, ReactNode } from "react";

/** What a field input needs besides the field. */
export interface FieldInputContext {
  /** Custom components by name. */
  components: Readonly<Record<string, ComponentType<FieldComponentProps>>>;
  /** Selected documents of relation fields, by field name. */
  relationOptions: Readonly<Record<string, RelationOption[]>>;
  /** Server function for relation searches. */
  serverFunction: AdminServerFunction;
  /** Plural labels of collections, for placeholders. */
  labels: Readonly<Record<string, string>>;
  /** The whole form is read-only. */
  readOnly: boolean;
}

const spans = {
  full: "qb:md:col-span-6",
  half: "qb:md:col-span-3",
  third: "qb:md:col-span-2",
} as const;

function widthOf(field: FieldMeta): keyof typeof spans {
  if (field.admin.width) return field.admin.width;
  if (
    field.many ||
    field.type === "textarea" ||
    field.type === "json" ||
    field.type === "boolean"
  ) {
    return "full";
  }
  return "half";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const inputTypes: Partial<Record<FieldMeta["type"], string>> = {
  text: "text",
  email: "email",
  url: "url",
  date: "date",
};

function SelectInput({
  field,
  value,
  props,
}: Readonly<{
  field: FieldMeta;
  value: unknown;
  props: ControlProps;
}>) {
  const options = field.options ?? [];
  if (!field.many) {
    return (
      <Select {...props} defaultValue={stringValue(value)}>
        {field.required ? null : <option value="">—</option>}
        {field.required && value === null ? <option value="">Choose…</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }
  const checked = new Set(Array.isArray(value) ? value.map(String) : []);
  return (
    <div
      id={props.id}
      role="group"
      aria-labelledby={`${props.id}-label`}
      aria-describedby={props["aria-describedby"]}
      className="qb:flex qb:flex-wrap qb:gap-x-5 qb:gap-y-2 qb:pt-1"
    >
      {options.map((option) => (
        <label key={option} className="qb:inline-flex qb:items-center qb:gap-2 qb:text-sm">
          <Checkbox
            name={props.name}
            value={option}
            defaultChecked={checked.has(option)}
            disabled={props.disabled}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

interface ControlProps {
  id: string;
  name: string;
  required: boolean;
  disabled: boolean;
  "aria-describedby": string;
}

function Control({
  field,
  value,
  props,
  context,
}: Readonly<{
  field: FieldMeta;
  value: unknown;
  props: ControlProps;
  context: FieldInputContext;
}>): ReactNode {
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          {...props}
          rows={5}
          defaultValue={stringValue(value)}
          minLength={field.minLength}
          maxLength={field.maxLength}
        />
      );
    case "number":
      return (
        <Input
          {...props}
          type="number"
          inputMode={field.integer ? "numeric" : "decimal"}
          step={field.integer ? 1 : "any"}
          min={field.min}
          max={field.max}
          defaultValue={stringValue(value)}
        />
      );
    case "boolean":
      return <Checkbox {...props} required={false} defaultChecked={value === true} />;
    case "datetime":
      return <Input {...props} type="datetime-local" defaultValue={toDatetimeLocal(value)} />;
    case "select":
      return <SelectInput field={field} value={value} props={props} />;
    case "relation": {
      const to = field.to ?? "";
      return (
        <RelationPicker
          id={props.id}
          name={props.name}
          many={field.many}
          required={props.required}
          disabled={props.disabled}
          describedBy={props["aria-describedby"]}
          initial={context.relationOptions[field.name] ?? []}
          serverFunction={context.serverFunction}
          relatedSlug={to}
          relatedLabel={context.labels[to] ?? to}
        />
      );
    }
    case "json":
      return (
        <JsonEditor
          id={props.id}
          name={props.name}
          defaultValue={toJsonText(value)}
          required={props.required}
          disabled={props.disabled}
          describedBy={props["aria-describedby"]}
        />
      );
    default:
      return (
        <Input
          {...props}
          type={inputTypes[field.type] ?? "text"}
          defaultValue={stringValue(value)}
          minLength={field.minLength}
          maxLength={field.maxLength}
        />
      );
  }
}

/** Label, input, hint and error of one field. Hidden fields render nothing. */
export function FieldInput({
  field,
  value,
  context,
}: Readonly<{
  field: FieldMeta;
  value: unknown;
  context: FieldInputContext;
}>) {
  if (field.admin.hidden) return null;
  const id = controlId(field.name);
  const hintId = `${id}-hint`;
  const describedBy = `${hintId} ${id}-error`;
  const disabled = context.readOnly || field.admin.readOnly === true;
  // Read-only inputs have no name, so they are not submitted.
  const props: ControlProps = {
    id,
    name: disabled ? "" : field.name,
    required: field.required && field.type !== "boolean",
    disabled,
    "aria-describedby": describedBy,
  };
  const Custom = field.admin.component ? context.components[field.admin.component] : undefined;
  const control = Custom ? (
    <Custom
      field={field}
      name={props.name}
      id={id}
      value={value}
      required={props.required}
      disabled={disabled}
      describedBy={describedBy}
    />
  ) : (
    <Control field={field} value={value} props={props} context={context} />
  );
  const inline = field.type === "boolean" && !Custom;
  const width = widthOf(field);
  const hint = field.description ?? (field.type === "datetime" && !Custom ? "Time in UTC." : null);
  const group = field.type === "select" && field.many && !Custom;
  const label = (
    <>
      {field.label}
      {props.required ? (
        <span className="qb:text-red-600" aria-hidden="true">
          {" "}
          *
        </span>
      ) : null}
    </>
  );
  return (
    <div data-field={field.name} className={cn("qb:space-y-1.5", spans[width])}>
      {inline ? (
        <div className={cn("qb:flex qb:items-center qb:gap-2", width !== "full" && "qb:md:pt-7")}>
          {control}
          <Label htmlFor={id}>{label}</Label>
        </div>
      ) : (
        <>
          {group ? (
            <p id={`${id}-label`} className="qb:text-sm qb:font-medium qb:text-zinc-900">
              {label}
            </p>
          ) : (
            <Label htmlFor={id} className="qb:block">
              {label}
            </Label>
          )}
          {control}
        </>
      )}
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      <FieldError name={field.name} />
    </div>
  );
}

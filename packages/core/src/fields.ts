import type { QuickbenUser } from "./auth";
import type { z } from "zod";

/** Every field type. */
export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "relation"
  | "json";

/** A JSON value. The value type of `json` fields without a `schema`. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Admin UI hints for a field. */
export interface FieldAdmin {
  hidden?: boolean;
  readOnly?: boolean;
  width?: "full" | "half" | "third";
  /**
   * Name of a custom input component. The admin UI looks it up in the `components` option of
   * `createAdminPage`. Core only stores the name, so configs stay free of UI code.
   */
  component?: string;
}

/** Context passed to a field's `validate` function. */
export interface FieldValidateContext {
  operation: "create" | "update";
  /** The whole validated payload. */
  data: Readonly<Record<string, unknown>>;
  /** The stored document on update, `null` on create. */
  original: Readonly<Record<string, unknown>> | null;
  user: QuickbenUser | null;
}

/** Custom validation. Return `true` when valid, or an error message. */
export type FieldValidator<TValue> = {
  bivarianceHack(
    value: TValue,
    context: FieldValidateContext,
  ): true | string | Promise<true | string>;
}["bivarianceHack"];

/** Type-level information carried by a field. It has no runtime value. */
export interface FieldTypes<
  TValue,
  TInput,
  TRequired extends boolean,
  THasDefault extends boolean,
> {
  value: TValue;
  input: TInput;
  required: TRequired;
  hasDefault: THasDefault;
}

interface FieldBase<
  TType extends FieldType,
  TValue,
  TInput,
  TRequired extends boolean,
  THasDefault extends boolean,
  TMany extends boolean,
> {
  readonly type: TType;
  readonly required: boolean;
  readonly many: TMany;
  readonly unique: boolean;
  readonly index: boolean;
  readonly default: TInput | (() => TInput) | undefined;
  readonly label: string | undefined;
  readonly description: string | undefined;
  readonly validate: FieldValidator<TValue> | undefined;
  readonly admin: FieldAdmin;
  /** Type-level only. Always `undefined` at runtime. */
  readonly "~types"?: FieldTypes<TValue, TInput, TRequired, THasDefault>;
}

/** Types of text-like fields. */
export type TextFieldType = "text" | "textarea" | "email" | "url";

/** Text-like field: `text`, `textarea`, `email` or `url`. */
export interface TextField<
  TType extends TextFieldType = TextFieldType,
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> extends FieldBase<TType, string, string, TRequired, THasDefault, false> {
  readonly minLength: number | undefined;
  readonly maxLength: number | undefined;
}

/** Number field. */
export interface NumberField<
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> extends FieldBase<"number", number, number, TRequired, THasDefault, false> {
  readonly integer: boolean;
  readonly min: number | undefined;
  readonly max: number | undefined;
}

/** Boolean field. */
export type BooleanField<
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = FieldBase<"boolean", boolean, boolean, TRequired, THasDefault, false>;

/**
 * Date (`YYYY-MM-DD`) or datetime (ISO 8601, UTC) field. Values are strings. Inputs also
 * accept `Date` objects.
 */
export type DateField<
  TType extends "date" | "datetime" = "date" | "datetime",
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> = FieldBase<TType, string, string | Date, TRequired, THasDefault, false>;

/** Select field with fixed options. `many: true` stores an array. */
export interface SelectField<
  TOption extends string = string,
  TMany extends boolean = boolean,
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> extends FieldBase<
  "select",
  TMany extends true ? TOption[] : TOption,
  TMany extends true ? TOption[] : TOption,
  TRequired,
  THasDefault,
  TMany
> {
  readonly options: readonly TOption[];
}

/**
 * Relation to documents of another collection, stored as ids. `many: true` stores an array.
 * `THasDefault` is `false` for `fields.relation()`. Plugins that fill a relation in a hook
 * (for example the tenancy `organization` field) type it as `true`, so create input may leave
 * it out.
 */
export interface RelationField<
  TTo extends string = string,
  TMany extends boolean = boolean,
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> extends FieldBase<
  "relation",
  TMany extends true ? string[] : string,
  TMany extends true ? string[] : string,
  TRequired,
  THasDefault,
  TMany
> {
  readonly to: TTo;
}

/** JSON field. Pass a Zod `schema` to validate and type the value. */
export interface JsonField<
  TValue = unknown,
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> extends FieldBase<"json", TValue, TValue, TRequired, THasDefault, false> {
  readonly schema: z.ZodType | undefined;
}

/** Any field definition. */
export type AnyField =
  TextField | NumberField | BooleanField | DateField | SelectField | RelationField | JsonField;

/** The fields of a collection, keyed by field name. */
export type Fields = Record<string, AnyField>;

type DefaultOf<T> = T | (() => T);
type HasDefault<TDefault> = [TDefault] extends [undefined] ? false : true;

/** Options shared by every field type. */
export interface FieldOptions<TValue, TRequired extends boolean, TDefault> {
  /** Required fields are never `null`. Default `false`. */
  required?: TRequired;
  /** Values must be unique in the collection. Enforced by the database adapter. */
  unique?: boolean;
  /** Ask the database adapter to index this field. */
  index?: boolean;
  /** Value used on create when the input leaves the field out. A function runs per create. */
  default?: TDefault;
  label?: string;
  description?: string;
  /** Runs after the built-in checks, only for values that are not `null`. */
  validate?: FieldValidator<TValue>;
  admin?: FieldAdmin;
}

/** Options for text-like fields. */
export interface TextOptions<TRequired extends boolean, TDefault> extends FieldOptions<
  string,
  TRequired,
  TDefault
> {
  minLength?: number;
  maxLength?: number;
}

/** Options for `number` fields. */
export interface NumberOptions<TRequired extends boolean, TDefault> extends FieldOptions<
  number,
  TRequired,
  TDefault
> {
  /** Only accept integers. Default `false`. */
  integer?: boolean;
  min?: number;
  max?: number;
}

/** Options for `select` fields. */
export interface SelectOptions<
  TOptions extends readonly string[],
  TMany extends boolean,
  TRequired extends boolean,
  TDefault,
> extends FieldOptions<
  TMany extends true ? TOptions[number][] : TOptions[number],
  TRequired,
  TDefault
> {
  options: TOptions;
  /** Store an array of options. Default `false`. */
  many?: TMany;
}

/** Options for `relation` fields. */
export interface RelationOptions<
  TTo extends string,
  TMany extends boolean,
  TRequired extends boolean,
> extends Omit<
  FieldOptions<TMany extends true ? string[] : string, TRequired, undefined>,
  "default"
> {
  /** Slug of the related collection. */
  to: TTo;
  /** Store an array of ids. Default `false`. */
  many?: TMany;
}

/** Options for `json` fields. */
export interface JsonOptions<TSchema, TRequired extends boolean, TDefault> extends FieldOptions<
  JsonOutput<TSchema>,
  TRequired,
  TDefault
> {
  /** Zod schema that validates the value and gives it a type. */
  schema?: TSchema;
}

type JsonOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : JsonValue;

type BaseInput = FieldOptions<unknown, boolean, unknown>;

function base<TType extends FieldType>(type: TType, options: BaseInput, many = false) {
  return {
    type,
    required: options.required ?? false,
    many,
    unique: options.unique ?? false,
    index: options.index ?? false,
    default: options.default,
    label: options.label,
    description: options.description,
    validate: options.validate,
    admin: options.admin ?? {},
  };
}

function textLike<TType extends TextFieldType>(
  type: TType,
  options: TextOptions<boolean, unknown>,
) {
  return {
    ...base(type, options),
    minLength: options.minLength,
    maxLength: options.maxLength,
  };
}

/** Single-line text. */
function text<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<string> | undefined = undefined,
>(options: TextOptions<TRequired, TDefault> = {}) {
  return textLike("text", options) as TextField<
    "text",
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** Multi-line text. */
function textarea<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<string> | undefined = undefined,
>(options: TextOptions<TRequired, TDefault> = {}) {
  return textLike("textarea", options) as TextField<
    "textarea",
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** Email address. */
function email<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<string> | undefined = undefined,
>(options: TextOptions<TRequired, TDefault> = {}) {
  return textLike("email", options) as TextField<
    "email",
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** `http` or `https` URL. */
function url<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<string> | undefined = undefined,
>(options: TextOptions<TRequired, TDefault> = {}) {
  return textLike("url", options) as TextField<
    "url",
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** Number. Use `integer: true` for whole numbers. */
function number<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<number> | undefined = undefined,
>(options: NumberOptions<TRequired, TDefault> = {}) {
  return {
    ...base("number", options),
    integer: options.integer ?? false,
    min: options.min,
    max: options.max,
  } as NumberField<NoInfer<TRequired>, NoInfer<HasDefault<TDefault>>>;
}

/** Boolean. */
function boolean<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<boolean> | undefined = undefined,
>(options: FieldOptions<boolean, TRequired, TDefault> = {}) {
  return base("boolean", options) as BooleanField<
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** Calendar date stored as `YYYY-MM-DD`. */
function date<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<string | Date> | undefined = undefined,
>(options: FieldOptions<string, TRequired, TDefault> = {}) {
  return base("date", options) as DateField<
    "date",
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** Point in time stored as an ISO 8601 UTC string. */
function datetime<
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<string | Date> | undefined = undefined,
>(options: FieldOptions<string, TRequired, TDefault> = {}) {
  return base("datetime", options) as DateField<
    "datetime",
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** One option (or several with `many: true`) from a fixed list. */
function select<
  const TOptions extends readonly [string, ...string[]],
  const TMany extends boolean = false,
  const TRequired extends boolean = false,
  TDefault extends
    DefaultOf<TMany extends true ? TOptions[number][] : TOptions[number]> | undefined = undefined,
>(options: SelectOptions<TOptions, TMany, TRequired, TDefault>) {
  return {
    ...base("select", options, options.many ?? false),
    options: options.options,
  } as unknown as SelectField<
    TOptions[number],
    NoInfer<TMany>,
    NoInfer<TRequired>,
    NoInfer<HasDefault<TDefault>>
  >;
}

/** Id of a document in another collection (or ids with `many: true`). */
function relation<
  const TTo extends string,
  const TMany extends boolean = false,
  const TRequired extends boolean = false,
>(options: RelationOptions<TTo, TMany, TRequired>) {
  return {
    ...base("relation", options, options.many ?? false),
    to: options.to,
  } as unknown as RelationField<TTo, NoInfer<TMany>, NoInfer<TRequired>, false>;
}

/** Any JSON value. Pass a Zod `schema` to validate and type it. */
function json<
  TSchema extends z.ZodType | undefined = undefined,
  const TRequired extends boolean = false,
  TDefault extends DefaultOf<JsonOutput<TSchema>> | undefined = undefined,
>(options: JsonOptions<TSchema, TRequired, TDefault> = {}) {
  return {
    ...base("json", options),
    schema: options.schema,
  } as JsonField<JsonOutput<TSchema>, NoInfer<TRequired>, NoInfer<HasDefault<TDefault>>>;
}

/** Field factories. Import as `fields` (or `f`) and call one per field. */
export const fields = {
  text,
  textarea,
  email,
  url,
  number,
  boolean,
  date,
  datetime,
  select,
  relation,
  json,
};

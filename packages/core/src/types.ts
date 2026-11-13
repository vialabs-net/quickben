import type { DatabaseAdapter } from "./adapter";
import type { AuthAdapter, QuickbenUser } from "./auth";
import type { AnyField, Fields, FieldTypes, RelationField } from "./fields";

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type MaybePromise<T> = T | Promise<T>;
type Types<F extends AnyField> = NonNullable<F["~types"]>;
type IsLoose<F> = string extends keyof F ? true : false;

/** Fields every document has. Timestamps are ISO 8601 UTC strings. */
export interface SystemFields {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Names of the system fields. */
export type SystemFieldName = keyof SystemFields;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

type IsRequired<F extends AnyField> = Types<F>["required"] extends true ? true : false;
type IsNullable<F extends AnyField> = F["many"] extends true
  ? false
  : IsRequired<F> extends true
    ? false
    : true;

/** Value of a field in a stored document. */
export type FieldValue<F extends AnyField> =
  IsNullable<F> extends true ? Types<F>["value"] | null : Types<F>["value"];

/** Value a field accepts in create and update input. */
export type FieldInput<F extends AnyField> =
  IsNullable<F> extends true ? Types<F>["input"] | null : Types<F>["input"];

type RequiredOnCreate<F extends Fields> = {
  [K in keyof F]: IsRequired<F[K]> extends true
    ? Types<F[K]>["hasDefault"] extends true
      ? never
      : K
    : never;
}[keyof F];

/** Document type for a set of fields. */
export type DocFromFields<F extends Fields> =
  IsLoose<F> extends true
    ? SystemFields & Record<string, unknown>
    : Simplify<SystemFields & { -readonly [K in keyof F]: FieldValue<F[K]> }>;

/** Create input for a set of fields. `id` is optional and generated when missing. */
export type CreateInputFromFields<F extends Fields> =
  IsLoose<F> extends true
    ? Record<string, unknown>
    : Simplify<
        { -readonly [K in RequiredOnCreate<F>]: FieldInput<F[K]> } & {
          -readonly [K in Exclude<keyof F, RequiredOnCreate<F>>]?: FieldInput<F[K]>;
        } & { id?: string }
      >;

/** Update input for a set of fields. Every key is optional. */
export type UpdateInputFromFields<F extends Fields> =
  IsLoose<F> extends true
    ? Record<string, unknown>
    : Simplify<{ -readonly [K in keyof F]?: FieldInput<F[K]> }>;

// ---------------------------------------------------------------------------
// Where and sort
// ---------------------------------------------------------------------------

/** Operators for text-like fields. `contains` and `startsWith` ignore case. */
export interface TextOperators {
  eq?: string;
  ne?: string;
  in?: readonly string[];
  notIn?: readonly string[];
  lt?: string;
  lte?: string;
  gt?: string;
  gte?: string;
  contains?: string;
  startsWith?: string;
  exists?: boolean;
}

/** Operators for numbers, dates and datetimes. */
export interface RangeOperators<T> {
  eq?: T;
  ne?: T;
  in?: readonly T[];
  notIn?: readonly T[];
  lt?: T;
  lte?: T;
  gt?: T;
  gte?: T;
  exists?: boolean;
}

/** Operators for booleans, selects, relations and ids. */
export interface EqualityOperators<T> {
  eq?: T;
  ne?: T;
  in?: readonly T[];
  notIn?: readonly T[];
  exists?: boolean;
}

/** Operators for array fields (`many: true`). `exists` means "not empty". */
export interface ArrayOperators<T> {
  contains?: T;
  in?: readonly T[];
  notIn?: readonly T[];
  exists?: boolean;
}

/** Operators for JSON fields. */
export interface JsonOperators {
  exists?: boolean;
}

/** Operators allowed for a field. */
export type FieldOperators<F extends AnyField> = F["many"] extends true
  ? ArrayOperators<Types<F>["value"] extends readonly (infer E)[] ? E : never>
  : F["type"] extends "number"
    ? RangeOperators<number>
    : F["type"] extends "date" | "datetime"
      ? RangeOperators<string | Date>
      : F["type"] extends "boolean"
        ? EqualityOperators<boolean>
        : F["type"] extends "select" | "relation"
          ? EqualityOperators<Types<F>["value"]>
          : F["type"] extends "json"
            ? JsonOperators
            : TextOperators;

/** Filter for a set of fields. Keys in one object are combined with AND. */
export type WhereFromFields<F extends Fields> =
  IsLoose<F> extends true
    ? LooseWhere
    : { -readonly [K in keyof F]?: FieldOperators<F[K]> } & {
        id?: EqualityOperators<string>;
        createdAt?: RangeOperators<string | Date>;
        updatedAt?: RangeOperators<string | Date>;
        and?: readonly WhereFromFields<F>[];
        or?: readonly WhereFromFields<F>[];
      };

/** Untyped filter, used when the collection type is not known. */
export interface LooseWhere {
  and?: readonly LooseWhere[];
  or?: readonly LooseWhere[];
  [field: string]: object | undefined;
}

type SortableKey<F extends Fields> =
  | {
      [K in keyof F]: F[K]["many"] extends true ? never : F[K]["type"] extends "json" ? never : K;
    }[keyof F]
  | SystemFieldName;

/** A sort key: `"field"` ascending or `"-field"` descending. */
export type SortKeyFromFields<F extends Fields> =
  IsLoose<F> extends true ? string : (SortableKey<F> & string) | `-${SortableKey<F> & string}`;

/** One sort key or several, applied in order. */
export type SortFromFields<F extends Fields> =
  SortKeyFromFields<F> | readonly SortKeyFromFields<F>[];

// ---------------------------------------------------------------------------
// Access and hooks
// ---------------------------------------------------------------------------

/** Request context. Every local API call takes one. */
export interface RequestContext {
  /** Current user, or `null` for anonymous calls. */
  user: QuickbenUser | null;
  /** Incoming request, when there is one. */
  req?: Request;
  /** Skip access checks. Default `false`. Use only for trusted server code. */
  overrideAccess?: boolean;
}

/** Operations that have access rules. */
export type AccessOperation = "read" | "create" | "update" | "delete";

/** Arguments of an access function. */
export interface AccessArgs {
  user: QuickbenUser | null;
  req: Request | undefined;
  /** The whole request context of the call, including keys added by plugins. */
  ctx: RequestContext;
  /**
   * Local API bound to the current transaction. Set when the local API runs the rule. UI code
   * that calls `checkAccess` itself may leave it out.
   */
  qb: Quickben | undefined;
  operation: AccessOperation;
  /** Document id, for `update`, `delete` and reads by id. */
  id: string | undefined;
  /** Input data, for `create` and `update`. */
  data: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Access function. Return `true` to allow, `false` to deny, or a filter. For reads the filter
 * is combined with the query (AND). For update and delete the stored document must match it.
 * For create the new document must match it.
 */
export type AccessFn<TWhere> = {
  bivarianceHack(args: AccessArgs): MaybePromise<boolean | TWhere>;
}["bivarianceHack"];

/** Access rules per operation. A missing rule allows only authenticated users. */
export interface CollectionAccess<F extends Fields = Fields> {
  read?: AccessFn<WhereFromFields<F>>;
  create?: AccessFn<WhereFromFields<F>>;
  update?: AccessFn<WhereFromFields<F>>;
  delete?: AccessFn<WhereFromFields<F>>;
}

/** Arguments shared by every hook. */
export interface HookArgs {
  user: QuickbenUser | null;
  req: Request | undefined;
  /** The whole request context of the call, including keys added by plugins. */
  ctx: RequestContext;
  /** Local API bound to the current transaction. */
  qb: Quickben;
  collection: SanitizedCollection;
}

/** What a hook may return: a replacement value, or nothing. */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- hooks may have no return statement
type HookResult<T> = T | undefined | void;

type HookFn<TArgs, TResult> = {
  bivarianceHack(args: TArgs): MaybePromise<TResult>;
}["bivarianceHack"];

/** Runs before validation. `data` is not validated yet. Return new data or nothing. */
export type BeforeValidateHook<F extends Fields = Fields> = HookFn<
  HookArgs &
    (
      | { operation: "create"; data: Partial<UpdateInputFromFields<F>>; original: null }
      | {
          operation: "update";
          data: Partial<UpdateInputFromFields<F>>;
          original: DocFromFields<F>;
        }
    ),
  HookResult<Partial<UpdateInputFromFields<F>>>
>;

type ChangeData<F extends Fields> = Omit<DocFromFields<F>, SystemFieldName>;

/** Runs after validation, before the write. Return new data or nothing. */
export type BeforeChangeHook<F extends Fields = Fields> = HookFn<
  HookArgs &
    (
      | { operation: "create"; data: ChangeData<F>; original: null }
      | { operation: "update"; data: Partial<ChangeData<F>>; original: DocFromFields<F> }
    ),
  HookResult<Partial<ChangeData<F>>>
>;

/** Runs after the write, in the same transaction. */
export type AfterChangeHook<F extends Fields = Fields> = HookFn<
  HookArgs & {
    operation: "create" | "update";
    doc: DocFromFields<F>;
    original: DocFromFields<F> | null;
  },
  void
>;

/** Runs for every document returned. Return a new document or nothing. */
export type AfterReadHook<F extends Fields = Fields> = HookFn<
  HookArgs & { doc: DocFromFields<F> },
  HookResult<DocFromFields<F>>
>;

/** Runs before a delete. Throw to cancel it. */
export type BeforeDeleteHook<F extends Fields = Fields> = HookFn<
  HookArgs & { id: string; doc: DocFromFields<F> },
  void
>;

/** Runs after a delete, in the same transaction. */
export type AfterDeleteHook<F extends Fields = Fields> = HookFn<
  HookArgs & { id: string; doc: DocFromFields<F> },
  void
>;

/** Hooks per stage. Each stage runs its functions in order. */
export interface CollectionHooks<F extends Fields = Fields> {
  beforeValidate?: readonly BeforeValidateHook<F>[];
  beforeChange?: readonly BeforeChangeHook<F>[];
  afterChange?: readonly AfterChangeHook<F>[];
  afterRead?: readonly AfterReadHook<F>[];
  beforeDelete?: readonly BeforeDeleteHook<F>[];
  afterDelete?: readonly AfterDeleteHook<F>[];
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** Admin UI options for a collection. */
export interface CollectionAdmin<F extends Fields = Fields> {
  /** Field shown as the document title. Default `id`. */
  useAsTitle?: (keyof F & string) | "id";
  /** Columns of the list view. */
  defaultColumns?: readonly ((keyof F & string) | SystemFieldName)[];
  /** Sidebar group label. */
  group?: string;
  /** Hide the collection from the admin UI. */
  hidden?: boolean;
  description?: string;
}

/** Input of {@link defineCollection}. */
export interface CollectionConfig<TSlug extends string = string, F extends Fields = Fields> {
  /** Lowercase identifier: letters, digits, `-` and `_`. Used in URLs and table names. */
  slug: TSlug;
  labels?: { singular?: string; plural?: string };
  fields: F;
  access?: CollectionAccess<F>;
  hooks?: CollectionHooks<F>;
  admin?: CollectionAdmin<F>;
}

/** A collection returned by `defineCollection`. */
export interface Collection<TSlug extends string = string, F extends Fields = Fields> {
  readonly slug: TSlug;
  readonly labels: { readonly singular: string; readonly plural: string };
  readonly fields: F;
  readonly access: CollectionAccess<F>;
  readonly hooks: CollectionHooks<F>;
  readonly admin: CollectionAdmin<F>;
}

/** A hook of any stage, with its arguments erased. */
export type AnyHook = HookFn<never, unknown>;

/**
 * Any collection. Access and hook types are erased so that every `Collection<S, F>` is
 * assignable to it.
 */
export interface AnyCollection {
  readonly slug: string;
  readonly labels: { readonly singular: string; readonly plural: string };
  readonly fields: Fields;
  readonly access: Partial<Readonly<Record<AccessOperation, AccessFn<object>>>>;
  readonly hooks: { readonly [K in keyof CollectionHooks]?: readonly AnyHook[] };
  readonly admin: Simplify<CollectionAdmin>;
}

/** A field with its name and label resolved. */
export type SanitizedField = AnyField & { readonly name: string; readonly label: string };

/** Collection metadata after `defineConfig`. Fields are listed in declaration order. */
export interface SanitizedCollection extends AnyCollection {
  readonly fieldList: readonly SanitizedField[];
}

/** Document type of a collection: `InferDoc<typeof posts>`. */
export type InferDoc<C extends AnyCollection> = DocFromFields<C["fields"]>;
/** Create input of a collection. */
export type InferCreateInput<C extends AnyCollection> = CreateInputFromFields<C["fields"]>;
/** Update input of a collection. */
export type InferUpdateInput<C extends AnyCollection> = UpdateInputFromFields<C["fields"]>;
/** Filter type of a collection. */
export type InferWhere<C extends AnyCollection> = WhereFromFields<C["fields"]>;
/** Sort type of a collection. */
export type InferSort<C extends AnyCollection> = SortFromFields<C["fields"]>;

// ---------------------------------------------------------------------------
// Config, plugins and modules
// ---------------------------------------------------------------------------

/** Collections keyed by slug. */
export type Registry = Record<string, AnyCollection>;

/** Build a registry from a union of collections. */
export type RegistryOf<C extends AnyCollection> = { [K in C as K["slug"]]: K };

/** Sidebar entry. Link to a collection or to any path. */
export interface NavItem {
  label: string;
  collection?: string;
  href?: string;
}

/**
 * A feature area that groups collections, e.g. "Sales". Products and plugins register modules.
 * Tenancy can enable them per organization.
 */
export interface Module {
  key: string;
  label: string;
  collections: readonly string[];
  nav?: readonly NavItem[];
}

/** Page metadata of the admin UI (`<title>`, description). */
export interface AdminMeta {
  /** Document title of admin pages. Default `Admin · <admin.title>`. */
  title?: string;
  /** Meta description of admin pages. */
  description?: string;
}

/** Admin UI options. */
export interface AdminConfig {
  /** Title shown in the admin UI. Default `Quickben`. */
  title?: string;
  /** Page metadata, used by `generateAdminMetadata` from `@quickben/admin`. */
  meta?: AdminMeta;
}

/** Runs once after the database is ready. */
export type InitHook = (qb: Quickben) => MaybePromise<void>;

/** The config that plugins receive and return. */
export interface PluginConfig {
  db: DatabaseAdapter;
  collections: readonly AnyCollection[];
  auth: AuthAdapter | undefined;
  admin: AdminConfig;
  modules: readonly Module[];
  onInit: readonly InitHook[];
  /** Names of plugins applied so far, in order. */
  plugins: readonly string[];
}

/** Fields a plugin adds to existing collections, keyed by collection slug. */
export type FieldExtensions = Readonly<Record<string, Fields>>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no fields added
type NoExtensions = {};

/**
 * A plugin is a function that takes the config and returns a new one. Plugins run in the
 * order they are listed. Use `definePlugin` to type the collections it adds (`TAdded`) and the
 * fields it adds to existing collections (`TExtends`, keyed by slug).
 */
export type Plugin<
  TAdded extends AnyCollection = never,
  TExtends extends FieldExtensions = NoExtensions,
> = ((config: PluginConfig) => PluginConfig) & {
  /** Type-level only. */
  readonly "~collections"?: TAdded;
  /** Type-level only. */
  readonly "~extends"?: TExtends;
};

/** Collections added by a plugin, as a union. */
export type PluginCollections<P> = P extends { readonly "~collections"?: infer C }
  ? C extends AnyCollection
    ? C
    : never
  : never;

/** Field extensions declared by a plugin (or a union of plugins), as a union. */
export type PluginExtensions<P> = P extends { readonly "~extends"?: infer X }
  ? X extends FieldExtensions
    ? X
    : never
  : never;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never;

/** Extra fields for slug `K` from a union of extensions. `never` when none adds any. */
type ExtraFieldsFor<X, K> = X extends unknown ? (K extends keyof X ? X[K] : never) : never;

type WithFields<C extends AnyCollection, F> = F extends Fields
  ? Collection<C["slug"], C["fields"] & F>
  : C;

/** Apply plugin field extensions to a registry. Collections no plugin extends stay as they are. */
export type ExtendRegistry<R extends Registry, X> = [X] extends [never]
  ? R
  : {
      [K in keyof R]: R[K] extends infer C extends AnyCollection
        ? [ExtraFieldsFor<X, K>] extends [never]
          ? C
          : WithFields<C, UnionToIntersection<ExtraFieldsFor<X, K>>>
        : never;
    };

/** Registry built by `defineConfig` from its collections and plugins. */
export type ConfigRegistry<C extends AnyCollection, P> = ExtendRegistry<
  RegistryOf<C | PluginCollections<P>>,
  PluginExtensions<P>
>;

/** Any plugin, whatever it adds. */
export type AnyPlugin = Plugin<AnyCollection, FieldExtensions>;

/** Input of `defineConfig`. */
export interface ConfigInput<
  C extends readonly AnyCollection[] = readonly AnyCollection[],
  P extends readonly AnyPlugin[] = readonly AnyPlugin[],
> {
  db: DatabaseAdapter;
  collections: C;
  plugins?: P;
  auth?: AuthAdapter;
  admin?: AdminConfig;
  modules?: readonly Module[];
}

/** The resolved config returned by `defineConfig`. */
export interface QuickbenConfig<R extends Registry = Registry> {
  readonly db: DatabaseAdapter;
  readonly collections: readonly SanitizedCollection[];
  readonly auth: AuthAdapter | undefined;
  readonly admin: Required<AdminConfig>;
  readonly modules: readonly Module[];
  readonly onInit: readonly InitHook[];
  readonly plugins: readonly string[];
  /** Type-level only. */
  readonly "~registry"?: R;
}

/** Collections of a config keyed by slug: `InferRegistry<typeof config>`. */
export type InferRegistry<TConfig> = TConfig extends QuickbenConfig<infer R> ? R : never;

// ---------------------------------------------------------------------------
// Local API
// ---------------------------------------------------------------------------

/** Population depth. `0` returns relation ids. */
export type Depth = 0 | 1 | 2 | 3;
type PrevDepth = [0, 0, 1, 2];

type FieldsOf<R extends Registry, S extends keyof R> = R[S]["fields"];

type PopulatedValue<R extends Registry, F extends AnyField, D extends Depth> =
  F extends RelationField<infer To, infer Many>
    ? To extends keyof R
      ? Many extends true
        ? (string | PopulatedDoc<R, To, D>)[]
        : IsNullable<F> extends true
          ? string | PopulatedDoc<R, To, D> | null
          : string | PopulatedDoc<R, To, D>
      : FieldValue<F>
    : FieldValue<F>;

/** A document with relations loaded to depth `D`. Unreadable or missing relations stay ids. */
export type PopulatedDoc<R extends Registry, S extends keyof R, D extends Depth> = D extends 0
  ? DocFromFields<FieldsOf<R, S>>
  : IsLoose<FieldsOf<R, S>> extends true
    ? DocFromFields<FieldsOf<R, S>>
    : Simplify<
        SystemFields & {
          -readonly [K in keyof FieldsOf<R, S>]: PopulatedValue<R, FieldsOf<R, S>[K], PrevDepth[D]>;
        }
      >;

/** Field names that can be passed to `select`. */
export type SelectKey<C extends AnyCollection> = (keyof C["fields"] & string) | SystemFieldName;

/** Document type returned by a read. */
export type ResultDoc<
  R extends Registry,
  S extends keyof R,
  TSelect extends readonly string[] | undefined,
  D extends Depth,
> = TSelect extends readonly string[]
  ? Simplify<
      Pick<PopulatedDoc<R, S, D>, Extract<TSelect[number] | "id", keyof PopulatedDoc<R, S, D>>>
    >
  : PopulatedDoc<R, S, D>;

/** Options of single-document reads. */
export interface ReadOptions<
  C extends AnyCollection,
  TSelect extends readonly SelectKey<C>[] | undefined,
  D extends Depth,
> {
  /** Return only these fields (and `id`). */
  select?: TSelect;
  /** Load related documents this many levels deep. Default `0`. */
  depth?: D;
}

/** Query of `find`. */
export interface FindQuery<
  C extends AnyCollection,
  TSelect extends readonly SelectKey<C>[] | undefined = undefined,
  D extends Depth = 0,
> extends ReadOptions<C, TSelect, D> {
  where?: InferWhere<C>;
  /** Default `-createdAt`. `id` is always added as the last key. */
  sort?: InferSort<C>;
  /** Page size. Default 20. */
  limit?: number;
  /** Page number, from 1. Do not combine with `cursor`. */
  page?: number;
  /** `nextCursor` of the previous result. Do not combine with `page`. */
  cursor?: string;
}

/** Result of `find`. Page fields are `null` when `cursor` was used. */
export interface FindResult<T> {
  docs: T[];
  limit: number;
  hasNextPage: boolean;
  /** Pass as `cursor` to get the next page. `null` on the last page. */
  nextCursor: string | null;
  page: number | null;
  totalDocs: number | null;
  totalPages: number | null;
}

/** Slugs of a registry. */
export type Slug<R extends Registry> = keyof R & string;

/** The local API. Get one with `getQuickben(config)`. */
export interface Quickben<R extends Registry = Registry> {
  readonly config: QuickbenConfig<R>;
  /** Collection metadata keyed by slug. */
  readonly collections: { readonly [S in keyof R]: SanitizedCollection };
  /** The database adapter. Use `qb.db.raw` for native queries. */
  readonly db: DatabaseAdapter;

  /** List documents. Applies read access. */
  find<
    S extends Slug<R>,
    const TSelect extends readonly SelectKey<R[S]>[] | undefined = undefined,
    D extends Depth = 0,
  >(
    slug: S,
    query: FindQuery<R[S], TSelect, D>,
    ctx: RequestContext,
  ): Promise<FindResult<ResultDoc<R, S, TSelect, D>>>;

  /** Get one document. Throws `NotFoundError` if it is missing or not readable. */
  findById<
    S extends Slug<R>,
    const TSelect extends readonly SelectKey<R[S]>[] | undefined = undefined,
    D extends Depth = 0,
  >(
    slug: S,
    id: string,
    options: RequestContext & ReadOptions<R[S], TSelect, D>,
  ): Promise<ResultDoc<R, S, TSelect, D>>;

  /** Count documents. Applies read access. */
  count<S extends Slug<R>>(
    slug: S,
    query: { where?: InferWhere<R[S]> },
    ctx: RequestContext,
  ): Promise<number>;

  /** Create a document. Runs validation and hooks in one transaction. */
  create<S extends Slug<R>>(
    slug: S,
    data: InferCreateInput<R[S]>,
    ctx: RequestContext,
  ): Promise<InferDoc<R[S]>>;

  /** Update a document by id. Runs validation and hooks in one transaction. */
  update<S extends Slug<R>>(
    slug: S,
    id: string,
    data: InferUpdateInput<R[S]>,
    ctx: RequestContext,
  ): Promise<InferDoc<R[S]>>;

  /** Delete a document by id. Returns the deleted document. */
  delete<S extends Slug<R>>(slug: S, id: string, ctx: RequestContext): Promise<InferDoc<R[S]>>;

  /** Run several calls in one transaction. */
  transaction<T>(fn: (qb: Quickben<R>) => Promise<T>): Promise<T>;
}

/** Field type information, re-exported for adapters and UI packages. */
export type { FieldTypes };

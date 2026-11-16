import { constraintChanges } from "./constraints";
import { compareText, isObject } from "./schemas";

import type {
  JsonSchema,
  OpenApiDocument,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
} from "./types";

/** Kinds of change found by {@link diffOpenApi}. */
export type OpenApiChangeKind =
  | "removed-path"
  | "removed-operation"
  | "removed-version"
  | "added-operation"
  | "added-version"
  | "deprecated"
  | "added-required-parameter"
  | "added-parameter"
  | "removed-parameter"
  | "parameter-required"
  | "added-required-body"
  | "removed-body"
  | "removed-media-type"
  | "removed-status"
  | "added-status"
  | "added-required-field"
  | "field-required"
  | "field-optional"
  | "added-field"
  | "removed-field"
  | "retyped"
  | "narrowed-enum"
  | "widened-enum"
  | "narrowed-constraint"
  | "widened-constraint"
  | "security-required"
  | "removed-security";

/** One difference between two documents. */
export interface OpenApiChange {
  kind: OpenApiChangeKind;
  /** Whether it can break existing clients. */
  breaking: boolean;
  /**
   * Set on breaking changes that do not fail the check: `version` when they come with a new
   * operation version, `sunset` when a deprecated operation is removed after its sunset date.
   */
  allowed?: "version" | "sunset";
  /** `GET`, `POST`, … */
  method: string;
  path: string;
  message: string;
}

/** Result of {@link diffOpenApi}. */
export interface OpenApiDiff {
  /** Breaking changes that are not allowed. The check fails when it is above 0. */
  breaking: number;
  /** Breaking changes allowed by a version change or a sunset. */
  allowed: number;
  nonBreaking: number;
  changes: OpenApiChange[];
}

/** Options of {@link diffOpenApi}. */
export interface DiffOptions {
  /** "Now", for sunset dates. Default: the current time. */
  now?: Date;
}

const methods: readonly OpenApiMethod[] = [
  "get",
  "put",
  "post",
  "patch",
  "delete",
  "head",
  "options",
];

interface Op {
  method: string;
  path: string;
  /** Method and path with parameter names removed. */
  key: string;
  /** `key` without the version prefix. */
  route: string;
  version: number | undefined;
  operation: OpenApiOperation;
}

type Direction = "request" | "response";

interface Scope {
  base: OpenApiDocument;
  head: OpenApiDocument;
  method: string;
  path: string;
  allowed: "version" | undefined;
  changes: OpenApiChange[];
}

function shape(path: string): string {
  return path.replaceAll(/\{[^{}/]*\}/g, "{}");
}

function versionOf(path: string, operation: OpenApiOperation): number | undefined {
  const declared = operation["x-quickben-version"];
  if (typeof declared === "number") return declared;
  const match = /^\/v(\d+)(?:\/|$)/.exec(path);
  return match ? Number(match[1]) : undefined;
}

function operationsOf(doc: OpenApiDocument): Op[] {
  const ops: Op[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const version = versionOf(path, operation);
      const unversioned =
        version === undefined ? path : path.replace(new RegExp(`^/v${String(version)}(?=/|$)`), "");
      const upper = method.toUpperCase();
      ops.push({
        method: upper,
        path,
        key: `${upper} ${shape(path)}`,
        route: `${upper} ${shape(unversioned)}`,
        version,
        operation,
      });
    }
  }
  return ops;
}

function add(
  scope: Pick<Scope, "method" | "path" | "changes"> & {
    allowed?: "version" | "sunset";
  },
  kind: OpenApiChangeKind,
  breaking: boolean,
  message: string,
): void {
  const change: OpenApiChange = { kind, breaking, method: scope.method, path: scope.path, message };
  if (breaking && scope.allowed) change.allowed = scope.allowed;
  scope.changes.push(change);
}

/** Follow `$ref`s to `#/…` inside a document. */
function resolvePointer(doc: OpenApiDocument, value: unknown, seen = new Set<string>()): unknown {
  if (!isObject(value) || typeof value.$ref !== "string") return value;
  const target = value.$ref;
  if (!target.startsWith("#/") || seen.has(target)) return value;
  seen.add(target);
  let current: unknown = doc;
  for (const part of target.slice(2).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    current = isObject(current) ? current[key] : undefined;
  }
  return current === undefined ? value : resolvePointer(doc, current, seen);
}

const typeNames = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

function typeOfValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function branches(schema: JsonSchema): JsonSchema[] | undefined {
  const list = schema.anyOf ?? schema.oneOf;
  return Array.isArray(list) ? list.filter(isObject) : undefined;
}

/** Types a schema allows. `undefined` means any type. */
function typesOf(doc: OpenApiDocument, schema: JsonSchema): Set<string> | undefined {
  const { type } = schema;
  if (typeof type === "string") return new Set([type]);
  if (Array.isArray(type))
    return new Set(type.filter((item) => typeNames.has(String(item))) as string[]);
  if ("const" in schema) return new Set([typeOfValue(schema.const)]);
  if (Array.isArray(schema.enum)) return new Set(schema.enum.map(typeOfValue));
  const list = branches(schema);
  if (list) {
    const all = new Set<string>();
    for (const branch of list) {
      const types = typesOf(doc, resolvePointer(doc, branch) as JsonSchema);
      if (!types) return undefined;
      for (const item of types) all.add(item);
    }
    return all;
  }
  if (isObject(schema.properties)) return new Set(["object"]);
  if (isObject(schema.items)) return new Set(["array"]);
  return undefined;
}

/** Whether `wide` allows every type in `narrow` (integers are numbers). */
function covers(wide: ReadonlySet<string>, narrow: ReadonlySet<string>): boolean {
  return [...narrow].every((type) => wide.has(type) || (type === "integer" && wide.has("number")));
}

function enumOf(schema: JsonSchema): unknown[] | undefined {
  if ("const" in schema) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum as unknown[];
  const list = branches(schema);
  if (!list) return undefined;
  const values: unknown[] = [];
  for (const branch of list) {
    if (branch.type === "null") {
      values.push(null);
      continue;
    }
    const inner = enumOf(branch);
    if (!inner) return undefined;
    values.push(...inner);
  }
  return values;
}

function format(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function label(at: string): string {
  return at === "" ? "the body" : `field "${at}"`;
}

/** The only non-null branch of a nullable `anyOf`, or the schema itself. */
function unwrap(doc: OpenApiDocument, schema: JsonSchema): JsonSchema {
  const list = branches(schema);
  if (!list) return schema;
  const rest = list.filter((branch) => branch.type !== "null");
  const only = rest.length === 1 ? rest[0] : undefined;
  return only ? (resolvePointer(doc, only) as JsonSchema) : schema;
}

interface SchemaPair {
  base: unknown;
  head: unknown;
  at: string;
  where: string;
  direction: Direction;
}

function compareTypes(scope: Scope, pair: SchemaPair, b: JsonSchema, h: JsonSchema): boolean {
  const bt = typesOf(scope.base, b);
  const ht = typesOf(scope.head, h);
  const request = pair.direction === "request";
  const narrowed = request
    ? ht !== undefined && (bt === undefined || !covers(ht, bt))
    : bt !== undefined && (ht === undefined || !covers(bt, ht));
  if (!narrowed) return false;
  const from = bt ? [...bt].sort(compareText).join(" | ") : "any";
  const to = ht ? [...ht].sort(compareText).join(" | ") : "any";
  add(scope, "retyped", true, `${pair.where} ${label(pair.at)} changed type from ${from} to ${to}`);
  return true;
}

function compareEnums(scope: Scope, pair: SchemaPair, b: JsonSchema, h: JsonSchema): void {
  const be = enumOf(b);
  const he = enumOf(h);
  if (!be && !he) return;
  const where = `${pair.where} ${label(pair.at)}`;
  const request = pair.direction === "request";
  if (!be || !he) {
    // A request enum that appears, or a response enum that goes away, narrows or widens.
    if (request && he) add(scope, "narrowed-enum", true, `${where} now only accepts ${format(he)}`);
    if (!request && be)
      add(scope, "widened-enum", true, `${where} is no longer limited to ${format(be)}`);
    return;
  }
  const key = (value: unknown) => JSON.stringify(value);
  const removed = be.filter((value) => !he.some((other) => key(other) === key(value)));
  const added = he.filter((value) => !be.some((other) => key(other) === key(value)));
  if (removed.length > 0) {
    add(scope, "narrowed-enum", request, `${where} no longer has ${format(removed)}`);
  }
  if (added.length > 0) {
    add(scope, "widened-enum", !request, `${where} has new values ${format(added)}`);
  }
}

function requiredOf(schema: JsonSchema): Set<string> {
  return new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
}

function propertiesOf(schema: JsonSchema): Record<string, unknown> {
  return isObject(schema.properties) ? schema.properties : {};
}

function child(at: string, name: string): string {
  return at === "" ? name : `${at}.${name}`;
}

interface ObjectPair {
  bp: Record<string, unknown>;
  hp: Record<string, unknown>;
  br: ReadonlySet<string>;
  hr: ReadonlySet<string>;
  closed: boolean;
}

function compareProperty(
  scope: Scope,
  pair: SchemaPair,
  objects: ObjectPair,
  name: string,
  seen: Set<string>,
): void {
  const { bp, hp, br, hr } = objects;
  const at = child(pair.at, name);
  const where = `${pair.where} ${label(at)}`;
  const request = pair.direction === "request";
  if (!Object.hasOwn(bp, name)) {
    if (request && hr.has(name)) {
      add(scope, "added-required-field", true, `${where} is new and required`);
    } else {
      add(scope, "added-field", false, `${where} was added`);
    }
    return;
  }
  if (!Object.hasOwn(hp, name)) {
    add(scope, "removed-field", !request || objects.closed, `${where} was removed`);
    return;
  }
  if (request && hr.has(name) && !br.has(name)) {
    add(scope, "field-required", true, `${where} is now required`);
  }
  if (!request && br.has(name) && !hr.has(name)) {
    add(scope, "field-optional", true, `${where} may now be missing`);
  }
  compareSchema(scope, { ...pair, base: bp[name], head: hp[name], at }, seen);
}

function compareObjects(
  scope: Scope,
  pair: SchemaPair,
  b: JsonSchema,
  h: JsonSchema,
  seen: Set<string>,
): void {
  const objects: ObjectPair = {
    bp: propertiesOf(b),
    hp: propertiesOf(h),
    br: requiredOf(b),
    hr: requiredOf(h),
    closed: h.additionalProperties === false,
  };
  const names = new Set([...Object.keys(objects.bp), ...Object.keys(objects.hp)]);
  for (const name of names) compareProperty(scope, pair, objects, name, seen);
}

function compareConstraints(scope: Scope, pair: SchemaPair, b: JsonSchema, h: JsonSchema): void {
  const breakingByMessage = new Map<string, boolean>();
  for (const change of constraintChanges(b, h)) {
    const breaking = pair.direction === "request" ? change.narrowed : !change.narrowed;
    breakingByMessage.set(
      change.message,
      (breakingByMessage.get(change.message) ?? false) || breaking,
    );
  }
  for (const [message, breaking] of breakingByMessage) {
    const narrowed = pair.direction === "request" ? breaking : !breaking;
    add(
      scope,
      narrowed ? "narrowed-constraint" : "widened-constraint",
      breaking,
      `${pair.where} ${label(pair.at)} ${message}`,
    );
  }
}

/** Branches of `anyOf` / `oneOf` without the `null` branch. */
function valueBranches(schema: JsonSchema): JsonSchema[] {
  return (branches(schema) ?? []).filter((branch) => branch.type !== "null");
}

/** Compare every accepted variant with its closest compatible variant, regardless of order. */
function compareUnions(
  scope: Scope,
  pair: SchemaPair,
  b: JsonSchema,
  h: JsonSchema,
  seen: Set<string>,
): boolean {
  const bBranches = valueBranches(b);
  const hBranches = valueBranches(h);
  if (bBranches.length <= 1 && hBranches.length <= 1) return false;
  const base = bBranches.length > 1 ? bBranches : [b];
  const head = hBranches.length > 1 ? hBranches : [h];
  const request = pair.direction === "request";
  const source = request ? base : head;
  const target = request ? head : base;
  for (const [index, variant] of source.entries()) {
    const candidates = target.map((other) => {
      const changes: OpenApiChange[] = [];
      compareSchema(
        { ...scope, changes },
        {
          ...pair,
          base: request ? variant : other,
          head: request ? other : variant,
          at: `${pair.at}<${String(index + 1)}>`,
        },
        new Set(seen),
      );
      return changes;
    });
    const count = (changes: OpenApiChange[]) => changes.filter((change) => change.breaking).length;
    const best = candidates.toSorted((a, b) => count(a) - count(b))[0] ?? [];
    scope.changes.push(...best);
  }
  return true;
}

function compareAdditional(
  scope: Scope,
  pair: SchemaPair,
  b: JsonSchema,
  h: JsonSchema,
  seen: Set<string>,
): void {
  const base = b.additionalProperties ?? true;
  const head = h.additionalProperties ?? true;
  if (base === head) return;
  if (isObject(base) && isObject(head)) {
    compareSchema(scope, { ...pair, base, head, at: child(pair.at, "*") }, seen);
    return;
  }
  const narrowed = head === false || (base === true && isObject(head));
  const breaking = pair.direction === "request" ? narrowed : !narrowed;
  add(
    scope,
    narrowed ? "narrowed-constraint" : "widened-constraint",
    breaking,
    `${pair.where} ${label(pair.at)} additionalProperties changed`,
  );
}

/** Compare the parts inside a schema: properties, values of maps, items and union branches. */
function compareInner(
  scope: Scope,
  pair: SchemaPair,
  b: JsonSchema,
  h: JsonSchema,
  seen: Set<string>,
) {
  if (compareUnions(scope, pair, b, h, seen)) return;
  compareObjects(scope, pair, b, h, seen);
  compareAdditional(scope, pair, b, h, seen);
  const baseItems: readonly unknown[] = Array.isArray(b.prefixItems) ? b.prefixItems : [];
  const headItems: readonly unknown[] = Array.isArray(h.prefixItems) ? h.prefixItems : [];
  for (let index = 0; index < Math.max(baseItems.length, headItems.length); index += 1) {
    compareSchema(
      scope,
      {
        ...pair,
        base: baseItems[index] ?? b.items,
        head: headItems[index] ?? h.items,
        at: `${pair.at}[${String(index)}]`,
      },
      seen,
    );
  }
  if (isObject(b.items) && isObject(h.items)) {
    compareSchema(scope, { ...pair, base: b.items, head: h.items, at: `${pair.at}[]` }, seen);
  }
}

function compareSchema(scope: Scope, pair: SchemaPair, seen = new Set<string>()): void {
  const bRef = isObject(pair.base) && typeof pair.base.$ref === "string" ? pair.base.$ref : "";
  const hRef = isObject(pair.head) && typeof pair.head.$ref === "string" ? pair.head.$ref : "";
  // References being compared higher up: stop, so recursive schemas end.
  const visit = bRef === "" && hRef === "" ? undefined : `${bRef}|${hRef}`;
  if (visit !== undefined) {
    if (seen.has(visit)) return;
    seen.add(visit);
  }
  const b = resolvePointer(scope.base, pair.base);
  const h = resolvePointer(scope.head, pair.head);
  if (isObject(b) && isObject(h) && !compareTypes(scope, pair, b, h)) {
    compareEnums(scope, pair, b, h);
    const bInner = unwrap(scope.base, b);
    const hInner = unwrap(scope.head, h);
    compareConstraints(scope, pair, bInner, hInner);
    compareInner(scope, pair, bInner, hInner, seen);
  }
  if (visit !== undefined) seen.delete(visit);
}

function parameterKey(parameter: OpenApiParameter): string {
  return `${parameter.in}:${parameter.name}`;
}

function parametersOf(doc: OpenApiDocument, operation: OpenApiOperation): OpenApiParameter[] {
  return (operation.parameters ?? [])
    .map((parameter) => resolvePointer(doc, parameter))
    .filter(isObject) as unknown as OpenApiParameter[];
}

function parameterSchema(parameter: OpenApiParameter): unknown {
  if (parameter.schema) return parameter.schema;
  return Object.values(parameter.content ?? {})[0]?.schema;
}

/** Path parameters are matched by position: their names are not part of the contract. */
function comparePathParameters(
  scope: Scope,
  bList: readonly OpenApiParameter[],
  hList: readonly OpenApiParameter[],
): void {
  const hPath = hList.filter((parameter) => parameter.in === "path");
  for (const [index, parameter] of bList.filter((p) => p.in === "path").entries()) {
    const other = hPath[index];
    if (!other) continue;
    compareSchema(scope, {
      base: parameterSchema(parameter),
      head: parameterSchema(other),
      at: "",
      where: `path parameter "${other.name}"`,
      direction: "request",
    });
  }
}

function namedParameters(list: readonly OpenApiParameter[]): Map<string, OpenApiParameter> {
  return new Map(list.filter((p) => p.in !== "path").map((p) => [parameterKey(p), p]));
}

function compareParameters(scope: Scope, base: OpenApiOperation, head: OpenApiOperation): void {
  const bList = parametersOf(scope.base, base);
  const hList = parametersOf(scope.head, head);
  comparePathParameters(scope, bList, hList);
  const bMap = namedParameters(bList);
  const hMap = namedParameters(hList);
  for (const [key, parameter] of hMap) {
    const name = `${parameter.in} parameter "${parameter.name}"`;
    const old = bMap.get(key);
    if (!old) {
      const required = parameter.required === true;
      const message = required ? `${name} is new and required` : `${name} was added`;
      add(scope, required ? "added-required-parameter" : "added-parameter", required, message);
      continue;
    }
    if (parameter.required === true && old.required !== true) {
      add(scope, "parameter-required", true, `${name} is now required`);
    }
    compareSchema(scope, {
      base: parameterSchema(old),
      head: parameterSchema(parameter),
      at: "",
      where: name,
      direction: "request",
    });
  }
  for (const [key, parameter] of bMap) {
    if (hMap.has(key)) continue;
    const message = `${parameter.in} parameter "${parameter.name}" was removed`;
    add(scope, "removed-parameter", false, message);
  }
}

function compareContent(
  scope: Scope,
  base: Record<string, { schema?: JsonSchema }> | undefined,
  head: Record<string, { schema?: JsonSchema }> | undefined,
  where: string,
  direction: Direction,
): void {
  for (const [type, media] of Object.entries(base ?? {})) {
    const other = head?.[type];
    if (!other) {
      add(scope, "removed-media-type", true, `${where} no longer has ${type}`);
      continue;
    }
    compareSchema(scope, { base: media.schema, head: other.schema, at: "", where, direction });
  }
}

function compareBody(scope: Scope, base: OpenApiOperation, head: OpenApiOperation): void {
  const b = base.requestBody;
  const h = head.requestBody;
  if (!h) {
    if (b) add(scope, "removed-body", false, "the request body was removed");
    return;
  }
  if (h.required === true && b?.required !== true) {
    add(scope, "added-required-body", true, "the request body is now required");
  }
  if (b) compareContent(scope, b.content, h.content, "request", "request");
}

function compareResponses(scope: Scope, base: OpenApiOperation, head: OpenApiOperation): void {
  const statuses = new Set([...Object.keys(base.responses), ...Object.keys(head.responses)]);
  for (const status of [...statuses].sort(compareText)) {
    const b = resolvePointer(scope.base, base.responses[status]) as OpenApiResponse | undefined;
    const h = resolvePointer(scope.head, head.responses[status]) as OpenApiResponse | undefined;
    if (!h) {
      add(scope, "removed-status", true, `response ${status} was removed`);
      continue;
    }
    if (!b) {
      // A new success status is a new kind of result; a new error status is not.
      add(scope, "added-status", /^[23]/.test(status), `response ${status} was added`);
      continue;
    }
    compareContent(scope, b.content, h.content, `response ${status}`, "response");
  }
}

type Requirements = readonly Record<string, readonly string[]>[];

function securityOf(doc: OpenApiDocument, operation: OpenApiOperation): Requirements {
  return operation.security ?? doc.security ?? [];
}

function anonymousAllowed(requirements: Requirements): boolean {
  return requirements.length === 0 || requirements.some((item) => Object.keys(item).length === 0);
}

function requirementKey(requirement: Record<string, readonly string[]>): string {
  return Object.keys(requirement).sort(compareText).join(" + ");
}

function schemeOf(doc: OpenApiDocument, name: string): string {
  const scheme = doc.components?.securitySchemes?.[name];
  if (!scheme) return "null";
  const entries = Object.entries(scheme)
    .filter(([key]) => key !== "description" && key !== "bearerFormat")
    .toSorted(([a], [b]) => compareText(a, b));
  return JSON.stringify(Object.fromEntries(entries));
}

/** Credentials that are now required, or no longer accepted. */
function compareSecurity(scope: Scope, base: OpenApiOperation, head: OpenApiOperation): void {
  const b = securityOf(scope.base, base);
  const h = securityOf(scope.head, head);
  if (anonymousAllowed(b)) {
    if (!anonymousAllowed(h)) add(scope, "security-required", true, "credentials are now required");
    return;
  }
  if (anonymousAllowed(h)) return;
  for (const requirement of b) {
    const accepted = h.some((other) =>
      Object.keys(other).every(
        (name) =>
          Object.hasOwn(requirement, name) &&
          (other[name] ?? []).every((scope) => requirement[name]?.includes(scope)) &&
          schemeOf(scope.base, name) === schemeOf(scope.head, name),
      ),
    );
    if (accepted) continue;
    const changed = Object.keys(requirement).find(
      (name) =>
        h.some((other) => Object.hasOwn(other, name)) &&
        schemeOf(scope.base, name) !== schemeOf(scope.head, name),
    );
    const message = changed
      ? `security scheme "${changed}" changed`
      : `credentials "${requirementKey(requirement)}" are no longer accepted`;
    add(scope, "removed-security", true, message);
  }
}

function compareOperations(scope: Scope, base: OpenApiOperation, head: OpenApiOperation): void {
  if (head.deprecated === true && base.deprecated !== true) {
    add(scope, "deprecated", false, "the operation is now deprecated");
  }
  compareSecurity(scope, base, head);
  compareParameters(scope, base, head);
  compareBody(scope, base, head);
  compareResponses(scope, base, head);
}

function sunsetPassed(operation: OpenApiOperation, now: Date): boolean {
  const sunset = operation["x-sunset"];
  if (operation.deprecated !== true || typeof sunset !== "string") return false;
  const time = new Date(sunset).getTime();
  return !Number.isNaN(time) && time <= now.getTime();
}

function latest(ops: readonly Op[]): Op | undefined {
  return [...ops].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
}

function assertDocument(doc: unknown, name: string): asserts doc is OpenApiDocument {
  if (!isObject(doc) || typeof doc.openapi !== "string" || !isObject(doc.paths)) {
    throw new Error(`[quickben] ${name} is not an OpenAPI document (no "openapi" or "paths")`);
  }
}

function removedOperation(
  op: Op,
  headOps: readonly Op[],
  headPaths: ReadonlySet<string>,
  now: Date,
  changes: OpenApiChange[],
) {
  const scope = { method: op.method, path: op.path, changes };
  if (sunsetPassed(op.operation, now)) {
    add(
      { ...scope, allowed: "sunset" },
      "removed-operation",
      true,
      "the operation was removed after its sunset date",
    );
    return;
  }
  const others = headOps.filter((other) => other.route === op.route);
  const newest = latest(others);
  if (newest) {
    const to = newest.version === undefined ? "no version" : `version ${String(newest.version)}`;
    add(scope, "removed-version", true, `this version was removed (${to} remains)`);
  } else if (headPaths.has(shape(op.path))) {
    add(scope, "removed-operation", true, "the operation was removed");
  } else {
    add(scope, "removed-path", true, "the path was removed");
  }
}

/**
 * Compare two OpenAPI documents and classify every change as breaking or not.
 *
 * | Breaking                                                         | Not breaking                        |
 * | ---------------------------------------------------------------- | ----------------------------------- |
 * | Removed path, operation or version                               | Added path, operation or version    |
 * | New required parameter, body or request field                    | New optional parameter or field     |
 * | Removed or retyped response field, field that may now be missing | New response field                  |
 * | Narrowed request enum, widened response enum                     | Widened request enum                |
 * | Removed status code, new success status code                     | New error status code               |
 *
 * Operations are matched by method and path. When a route gets a new version (`/v2/…`), the
 * new operation is compared with the latest older one and its breaking changes are allowed.
 * Removing a deprecated operation after its `x-sunset` date is allowed too.
 */
export function diffOpenApi(base: unknown, head: unknown, options: DiffOptions = {}): OpenApiDiff {
  assertDocument(base, "The base document");
  assertDocument(head, "The head document");
  const now = options.now ?? new Date();
  const baseOps = operationsOf(base);
  const headOps = operationsOf(head);
  const baseByKey = new Map(baseOps.map((op) => [op.key, op]));
  const headByKey = new Map(headOps.map((op) => [op.key, op]));
  const headPaths = new Set(headOps.map((op) => shape(op.path)));
  const changes: OpenApiChange[] = [];
  for (const op of baseOps) {
    const match = headByKey.get(op.key);
    if (match) {
      compareOperations(
        { base, head, method: match.method, path: match.path, allowed: undefined, changes },
        op.operation,
        match.operation,
      );
    } else {
      removedOperation(op, headOps, headPaths, now, changes);
    }
  }
  for (const op of headOps) {
    if (baseByKey.has(op.key)) continue;
    const previous = latest(baseOps.filter((other) => other.route === op.route));
    const scope = { base, head, method: op.method, path: op.path, changes };
    if (previous && (op.version ?? 0) > (previous.version ?? 0)) {
      add(scope, "added-version", false, `new version ${String(op.version)} of ${previous.path}`);
      compareOperations({ ...scope, allowed: "version" }, previous.operation, op.operation);
    } else {
      add(scope, "added-operation", false, "the operation was added");
    }
  }
  const breaking = changes.filter((change) => change.breaking && !change.allowed).length;
  const allowed = changes.filter((change) => change.breaking && change.allowed).length;
  return { breaking, allowed, nonBreaking: changes.length - breaking - allowed, changes };
}

/** A readable report of a diff, one change per line. */
export function formatDiff(diff: OpenApiDiff): string {
  const groups: [string, OpenApiChange[]][] = [
    ["Breaking changes", diff.changes.filter((c) => c.breaking && !c.allowed)],
    ["Allowed breaking changes", diff.changes.filter((c) => c.breaking && c.allowed)],
    ["Non-breaking changes", diff.changes.filter((c) => !c.breaking)],
  ];
  const lines: string[] = [];
  for (const [title, list] of groups) {
    if (list.length === 0) continue;
    lines.push(`${title} (${String(list.length)}):`);
    for (const change of list) {
      const reason = change.allowed ? ` [allowed: ${change.allowed}]` : "";
      lines.push(`  ${change.method} ${change.path}: ${change.message}${reason}`);
    }
    lines.push("");
  }
  if (lines.length === 0) return "No changes.\n";
  return `${lines.join("\n").trimEnd()}\n`;
}

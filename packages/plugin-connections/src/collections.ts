import { ConflictError, defineCollection, fields as f, ValidationError } from "@quickben/core";
import { z } from "zod";

import { encryptSecret, MasterKeyError } from "./crypto";
import { CONNECTIONS, CREDENTIALS } from "./options";
import { CREDENTIAL_KINDS } from "./provider";
import { checkSecret, secretLast4 } from "./secret";

import type { ResolvedConnections } from "./options";
import type { AnyProvider, CredentialKind } from "./provider";
import type { AccessArgs, DocumentData, Quickben, ValidationIssue } from "@quickben/core";

/** The outcome of the last test, stored on connections and credentials. */
export const lastTestSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  /** The tester's own text. Never a provider message. */
  error: z.string().nullable(),
  latencyMs: z.number().nullable(),
  /** The model that answered, for LLM providers. */
  model: z.string().nullable(),
  /** The provider a credential was tested against. */
  providerType: z.string().nullable(),
});

/** The outcome of the last test. */
export type LastTest = z.output<typeof lastTestSchema>;

const kinds = CREDENTIAL_KINDS.map((k) => k.kind) as [CredentialKind, ...CredentialKind[]];

/** Fields of the `credentials` collection. */
export function credentialFields() {
  return {
    name: f.text({ required: true, maxLength: 120 }),
    kind: f.select({ options: kinds, required: true, default: "api_key" }),
    /**
     * Write-only. Clear text on the way in, encrypted at rest, always `null` when read. Leave it
     * out to keep the stored secret; `null` removes it.
     */
    secret: f.textarea({
      maxLength: 20_000,
      description: "Write-only. Leave it empty to keep the stored secret.",
    }),
    /** The last 4 characters of the secret, for the UI. Set by the plugin. */
    last4: f.text({ admin: { readOnly: true } }),
    /** Whether a secret is stored. Set by the plugin. */
    hasSecret: f.boolean({ admin: { readOnly: true } }),
    lastTest: f.json({ schema: lastTestSchema, admin: { readOnly: true } }),
  };
}

const metadataSchema = z.record(z.string(), z.unknown());

/** Fields of the `connections` collection. */
export function connectionFields() {
  return {
    name: f.text({ required: true, maxLength: 120 }),
    /** A registered provider type. Cannot change after create. */
    providerType: f.text({ required: true, index: true, maxLength: 60 }),
    baseUrl: f.url({ maxLength: 500 }),
    /** Non-secret settings, validated by the provider's `fields` schema. */
    metadata: f.json({ schema: metadataSchema, required: true, default: () => ({}) }),
    credential: f.relation({ to: CREDENTIALS, index: true }),
    enabled: f.boolean({ required: true, default: true }),
    lastTest: f.json({ schema: lastTestSchema, admin: { readOnly: true } }),
  };
}

/** Keys only the plugin writes. Callers with `overrideAccess` may set them. */
const credentialSystemKeys = ["last4", "hasSecret", "lastTest"] as const;

function rules(state: ResolvedConnections) {
  const read = ({ user }: AccessArgs) => user !== null && state.canRead(user);
  const manage = ({ user }: AccessArgs) => user !== null && state.canManage(user);
  return { read, create: manage, update: manage, delete: manage };
}

function withoutKeys(data: DocumentData, keys: readonly string[]): DocumentData {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
}

/** The `credentials` collection. Secrets are encrypted in `beforeChange` and never read back. */
export function credentialsCollection(state: ResolvedConnections) {
  return defineCollection({
    slug: CREDENTIALS,
    labels: { singular: "Credential", plural: "Credentials" },
    fields: credentialFields(),
    access: rules(state),
    hooks: {
      beforeValidate: [
        ({ operation, data, ctx }) => {
          let next: DocumentData = ctx.overrideAccess
            ? { ...data }
            : withoutKeys(data, credentialSystemKeys);
          if (typeof next.secret === "string" && next.secret.trim() === "") {
            next = withoutKeys(next, ["secret"]);
          }
          if (operation === "create" && typeof next.secret !== "string") {
            throw new ValidationError([{ path: "secret", message: "Required" }]);
          }
          return next;
        },
      ],
      beforeChange: [
        ({ operation, data, original }) => {
          const kind = operation === "create" ? data.kind : (data.kind ?? original.kind);
          if (typeof data.secret === "string") {
            const secret = data.secret.trim();
            const valid = checkSecret(kind, secret);
            if (valid !== true) throw new ValidationError([{ path: "secret", message: valid }]);
            const [key] = state.keys;
            if (!key) {
              throw new MasterKeyError(
                "Set the connections masterKey (e.g. QUICKBEN_MASTER_KEY) to store secrets",
              );
            }
            return {
              ...data,
              secret: encryptSecret(secret, key),
              last4: secretLast4(kind, secret),
              hasSecret: true,
            };
          }
          if (operation === "create") return data;
          if (data.secret === null) return { ...data, last4: null, hasSecret: false };
          if (data.kind !== undefined && data.kind !== original.kind && original.hasSecret) {
            throw new ValidationError([
              { path: "secret", message: "A credential of another kind needs a new secret" },
            ]);
          }
          return data;
        },
      ],
      afterRead: [({ doc }) => ({ ...doc, secret: null })],
      beforeDelete: [
        async ({ id, qb }) => {
          const used = await qb.db.count({
            collection: CONNECTIONS,
            where: { field: "credential", op: "eq", value: id },
          });
          if (used > 0) {
            throw new ConflictError(
              `The credential is used by ${String(used)} connection(s). Remove it from them first.`,
              "credential",
            );
          }
        },
      ],
    },
    admin: {
      useAsTitle: "name",
      defaultColumns: ["name", "kind", "last4", "updatedAt"],
      group: state.group,
      description: "Secrets for connections. Encrypted at rest; never shown again.",
    },
  });
}

async function credentialKind(qb: Quickben, id: string): Promise<CredentialKind | undefined> {
  const row = await qb.db.findOne({
    collection: CREDENTIALS,
    where: { field: "id", op: "eq", value: id },
    select: ["id", "kind"],
  });
  return row?.kind as CredentialKind | undefined;
}

/** Zod issues → validation issues under `prefix`. */
export function zodIssues(error: z.ZodError, prefix: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}

/** The value a field has after the change: the new one, else the stored one. */
function after(next: DocumentData, original: DocumentData | null, key: string): unknown {
  return next[key] === undefined ? original?.[key] : next[key];
}

async function credentialIssues(
  provider: AnyProvider,
  next: DocumentData,
  original: DocumentData | null,
  qb: Quickben,
): Promise<ValidationIssue[]> {
  const credential = after(next, original, "credential");
  if (typeof credential !== "string" || credential === "") {
    return provider.credential.required
      ? [{ path: "credential", message: `${provider.label} needs a credential` }]
      : [];
  }
  if (next.credential === undefined) return [];
  const kind = await credentialKind(qb, credential);
  return kind && !provider.credential.kinds.includes(kind)
    ? [
        {
          path: "credential",
          message: `${provider.label} does not take a credential of kind ${kind}`,
        },
      ]
    : [];
}

async function checkConnection(
  provider: AnyProvider,
  data: DocumentData,
  original: DocumentData | null,
  qb: Quickben,
): Promise<DocumentData> {
  const next = { ...data };
  const issues: ValidationIssue[] = [];
  // A cleared URL (or none on create) falls back to the provider default.
  if (next.baseUrl === null || (original === null && next.baseUrl === undefined)) {
    next.baseUrl = provider.baseUrl.default ?? null;
  }
  if (provider.baseUrl.required && !after(next, original, "baseUrl")) {
    issues.push({ path: "baseUrl", message: `${provider.label} needs a base URL` });
  }
  issues.push(...(await credentialIssues(provider, next, original, qb)));
  if (original === null || next.metadata !== undefined) {
    const parsed = provider.fields.safeParse(next.metadata ?? {});
    if (parsed.success) next.metadata = parsed.data;
    else issues.push(...zodIssues(parsed.error, "metadata"));
  }
  if (issues.length > 0) throw new ValidationError(issues);
  return next;
}

/** The `connections` collection. */
export function connectionsCollection(state: ResolvedConnections) {
  return defineCollection({
    slug: CONNECTIONS,
    labels: { singular: "Connection", plural: "Connections" },
    fields: connectionFields(),
    access: rules(state),
    hooks: {
      beforeValidate: [
        ({ operation, data, original, ctx }) => {
          const next = ctx.overrideAccess ? { ...data } : withoutKeys(data, ["lastTest"]);
          if (
            operation === "update" &&
            next.providerType !== undefined &&
            next.providerType !== original.providerType
          ) {
            throw new ValidationError([
              { path: "providerType", message: "The provider type cannot change" },
            ]);
          }
          return next;
        },
      ],
      beforeChange: [
        async ({ operation, data, original, qb }) => {
          const type = operation === "create" ? data.providerType : original.providerType;
          const provider = state.providers.get(type);
          if (!provider) {
            throw new ValidationError([
              { path: "providerType", message: `Unknown provider type "${type}"` },
            ]);
          }
          return checkConnection(provider, data, original, qb);
        },
      ],
    },
    admin: {
      useAsTitle: "name",
      defaultColumns: ["name", "providerType", "enabled", "updatedAt"],
      group: state.group,
      description: "External providers and the credential each one uses.",
    },
  });
}

/** The `credentials` collection type. */
export type CredentialsCollection = ReturnType<typeof credentialsCollection>;
/** The `connections` collection type. */
export type ConnectionsCollection = ReturnType<typeof connectionsCollection>;

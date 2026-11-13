import { ForbiddenError, UnauthorizedError } from "@quickben/core";

import { decryptSecret, encryptSecret, MasterKeyError, sealedKeyId } from "./crypto";
import { ConnectionError } from "./errors";
import { CONNECTIONS, CREDENTIALS, getConnectionsOptions } from "./options";
import { redactSecrets, secretVariants } from "./redact";

import type { LastTest } from "./collections";
import type { ResolvedConnections } from "./options";
import type { AnyProvider, CredentialKind, ResolvedSecret, TestResult } from "./provider";
import type { DocumentData, Quickben, RequestContext } from "@quickben/core";

/** Trusted server code: no user, access rules skipped. The default context of the helpers. */
export const systemContext: RequestContext = { user: null, overrideAccess: true };

/** A connection as reads return it. `C` is the credential: an id, or a document with `depth`. */
export interface ConnectionRecord<C = string | null> {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  metadata: Record<string, unknown>;
  credential: C;
  enabled: boolean;
  lastTest: LastTest | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/** A credential as reads return it. `secret` is always `null`. */
export interface CredentialRecord {
  id: string;
  name: string;
  kind: CredentialKind;
  secret: null;
  last4: string | null;
  hasSecret: boolean | null;
  lastTest: LastTest | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/** A connection ready for a call. Server code only: `credential.secret` is clear text. */
export interface ResolvedConnection {
  readonly connection: ConnectionRecord;
  readonly provider: AnyProvider;
  /** The connection's base URL, or the provider default. */
  readonly baseUrl: string | null;
  /** The metadata parsed by the provider schema (defaults filled). */
  readonly metadata: Record<string, unknown>;
  readonly credential: ResolvedSecret | null;
}

/** Options of {@link getConnection}. */
export interface GetConnectionOptions {
  /** Also return a disabled connection. Default `false`: it throws `ConnectionError`. */
  allowDisabled?: boolean;
}

/** The outcome of a test, as returned to the caller and summarized in `lastTest`. */
export interface TestOutcome extends TestResult {
  readonly latencyMs: number;
  readonly providerType: string;
}

/** Input of {@link testCredential}. */
export interface TestCredentialInput {
  /** The provider to try the credential with. Default: the provider of its first connection. */
  providerType?: string;
  /** Default: the URL of a connection of that provider that uses it, else the provider's. */
  baseUrl?: string | null;
  model?: string;
}

function provider(state: ResolvedConnections, type: string): AnyProvider {
  const found = state.providers.get(type);
  if (!found) throw new ConnectionError("unknown-provider", `Unknown provider type "${type}"`);
  return found;
}

function decrypt(state: ResolvedConnections, sealed: string): string {
  if (state.keys.length === 0) {
    throw new MasterKeyError(
      "Set the connections masterKey (e.g. QUICKBEN_MASTER_KEY) to use secrets",
    );
  }
  return decryptSecret(sealed, state.keys);
}

async function rawById(qb: Quickben, collection: string, id: string): Promise<DocumentData | null> {
  return qb.db.findOne({ collection, where: { field: "id", op: "eq", value: id } });
}

/**
 * A credential with its secret in clear text. Server code only: never send the result to a
 * browser. `ctx` decides who may read the credential (default: {@link systemContext}).
 */
export async function resolveCredential(
  qb: Quickben,
  id: string,
  ctx: RequestContext = systemContext,
): Promise<ResolvedSecret> {
  const state = getConnectionsOptions(qb);
  const credential = (await qb.findById(CREDENTIALS, id, {}, ctx)) as unknown as CredentialRecord;
  const row = await rawById(qb, CREDENTIALS, id);
  const sealed = row?.secret;
  if (typeof sealed !== "string" || sealed === "") {
    throw new ConnectionError("no-secret", `Credential "${credential.name}" has no secret`);
  }
  return { id, kind: credential.kind, secret: decrypt(state, sealed) };
}

function parseMetadata(target: AnyProvider, metadata: unknown): Record<string, unknown> {
  const parsed = target.fields.safeParse(metadata ?? {});
  // Stored metadata was valid when saved; a changed schema falls back to its defaults.
  if (parsed.success) return parsed.data as Record<string, unknown>;
  const defaults = target.fields.safeParse({});
  return defaults.success ? (defaults.data as Record<string, unknown>) : {};
}

/**
 * A connection with its provider, parsed metadata and decrypted credential, ready for a call.
 * Server code only. Throws `ConnectionError` when it is disabled (unless `allowDisabled`), its
 * provider is not registered, or it needs a credential it does not have.
 */
export async function getConnection(
  qb: Quickben,
  id: string,
  ctx: RequestContext = systemContext,
  options: GetConnectionOptions = {},
): Promise<ResolvedConnection> {
  const state = getConnectionsOptions(qb);
  const connection = (await qb.findById(CONNECTIONS, id, {}, ctx)) as unknown as ConnectionRecord;
  if (!connection.enabled && options.allowDisabled !== true) {
    throw new ConnectionError("disabled", `Connection "${connection.name}" is disabled`);
  }
  const target = provider(state, connection.providerType);
  let credential: ResolvedSecret | null = null;
  if (connection.credential) {
    credential = await resolveCredential(qb, connection.credential, ctx);
  } else if (target.credential.required) {
    throw new ConnectionError("no-credential", `${target.label} needs a credential`);
  }
  if (credential && !target.credential.kinds.includes(credential.kind)) {
    throw new ConnectionError(
      "wrong-kind",
      `${target.label} does not take a ${credential.kind} credential`,
    );
  }
  return {
    connection,
    provider: target,
    baseUrl: connection.baseUrl ?? target.baseUrl.default ?? null,
    metadata: parseMetadata(target, connection.metadata),
    credential,
  };
}

/** Options of {@link findConnectionsByCapability}. */
export interface FindByCapabilityOptions {
  /** Also list disabled connections. Default `false`. */
  includeDisabled?: boolean;
}

/**
 * Connections whose provider has `capability` (e.g. `vision`), enabled ones by default, sorted
 * by name. No secrets: call {@link getConnection} for the one you use.
 */
export async function findConnectionsByCapability(
  qb: Quickben,
  capability: string,
  ctx: RequestContext = systemContext,
  options: FindByCapabilityOptions = {},
): Promise<ConnectionRecord[]> {
  const state = getConnectionsOptions(qb);
  const types = [...state.providers.values()]
    .filter((p) => p.capabilities.includes(capability))
    .map((p) => p.type);
  if (types.length === 0) return [];
  const where = {
    providerType: { in: types },
    ...(options.includeDisabled === true ? {} : { enabled: { eq: true } }),
  };
  const docs: ConnectionRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await qb.find(
      CONNECTIONS,
      { where, sort: ["name"], limit: 500, ...(cursor === undefined ? {} : { cursor }) },
      ctx,
    );
    docs.push(...(page.docs as unknown as ConnectionRecord[]));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return docs;
}

/** Every registered provider. */
export function listProviders(qb: Quickben): AnyProvider[] {
  return [...getConnectionsOptions(qb).providers.values()];
}

function assertCanManage(state: ResolvedConnections, ctx: RequestContext): void {
  if (ctx.overrideAccess === true) return;
  if (!ctx.user) throw new UnauthorizedError();
  if (!state.canManage(ctx.user))
    throw new ForbiddenError("Only an integrations admin can run tests");
}

interface RunInput {
  provider: AnyProvider;
  baseUrl: string | null;
  metadata: Record<string, unknown>;
  credential: ResolvedSecret | null;
  model: string | undefined;
}

/**
 * Run a provider test with a timeout. Exceptions become a fixed error text, `detail` goes
 * through the provider's `redactResponse`, and the secret is removed from everything returned.
 */
async function runTest(state: ResolvedConnections, input: RunInput): Promise<TestOutcome> {
  const { provider: target } = input;
  if (!target.test) throw new ConnectionError("not-testable", `${target.label} has no test`);
  const started = performance.now();
  let result: TestResult;
  try {
    result = await target.test({
      baseUrl: input.baseUrl,
      metadata: input.metadata,
      credential: input.credential,
      model: input.model,
      fetch: state.fetch,
      signal: AbortSignal.timeout(state.testTimeoutMs),
    });
  } catch {
    result = { ok: false, error: `${target.label} did not answer, or the request failed.` };
  }
  const latencyMs = Math.round(performance.now() - started);
  const detail =
    result.detail === undefined
      ? {}
      : { detail: target.redactResponse ? target.redactResponse(result.detail) : result.detail };
  const outcome: TestOutcome = {
    ok: result.ok,
    latencyMs,
    providerType: target.type,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.model === undefined ? {} : { model: result.model }),
    ...detail,
  };
  return input.credential
    ? redactSecrets(outcome, secretVariants(input.credential.secret))
    : outcome;
}

function lastTestOf(outcome: TestOutcome): LastTest {
  return {
    at: new Date().toISOString(),
    ok: outcome.ok,
    error: outcome.error ?? null,
    latencyMs: outcome.latencyMs,
    model: outcome.model ?? null,
    providerType: outcome.providerType,
  };
}

async function recordTest(qb: Quickben, collection: string, id: string, outcome: TestOutcome) {
  await qb.db.update({ collection, id, data: { lastTest: lastTestOf(outcome) } });
}

/**
 * Test a connection (also a disabled one) and store the outcome in `lastTest`. Needs the manage
 * permission. `model` picks an LLM model; default: the connection's default model.
 */
export async function testConnection(
  qb: Quickben,
  id: string,
  ctx: RequestContext = systemContext,
  options: { model?: string } = {},
): Promise<TestOutcome> {
  const state = getConnectionsOptions(qb);
  assertCanManage(state, ctx);
  const resolved = await getConnection(qb, id, ctx, { allowDisabled: true });
  const outcome = await runTest(state, { ...resolved, model: options.model });
  await recordTest(qb, CONNECTIONS, id, outcome);
  return outcome;
}

/**
 * Test a credential against a provider and store the outcome in its `lastTest`. Without
 * `providerType` it uses the provider of its first connection; an unused credential needs one
 * (`ConnectionError` with reason `pick-provider`).
 */
export async function testCredential(
  qb: Quickben,
  id: string,
  ctx: RequestContext = systemContext,
  input: TestCredentialInput = {},
): Promise<TestOutcome> {
  const state = getConnectionsOptions(qb);
  assertCanManage(state, ctx);
  const credential = await resolveCredential(qb, id, ctx);
  const linked = (
    await qb.find(
      CONNECTIONS,
      { where: { credential: { eq: id } }, sort: ["createdAt"], limit: 100 },
      ctx,
    )
  ).docs as unknown as ConnectionRecord[];
  const type = input.providerType ?? linked[0]?.providerType;
  if (type === undefined) {
    throw new ConnectionError("pick-provider", "Choose a provider to test the credential with");
  }
  const target = provider(state, type);
  if (!target.credential.kinds.includes(credential.kind)) {
    throw new ConnectionError(
      "wrong-kind",
      `${target.label} does not take a ${credential.kind} credential`,
    );
  }
  const sameProvider = linked.find((connection) => connection.providerType === type);
  const baseUrl = input.baseUrl ?? sameProvider?.baseUrl ?? target.baseUrl.default ?? null;
  const outcome = await runTest(state, {
    provider: target,
    baseUrl,
    metadata: parseMetadata(target, sameProvider?.metadata),
    credential,
    model: input.model,
  });
  await recordTest(qb, CREDENTIALS, id, outcome);
  return outcome;
}

/** Result of {@link rotateMasterKey}. */
export interface RotationResult {
  /** Secrets sealed again with the current key. */
  rotated: number;
  /** Secrets already sealed with the current key. */
  current: number;
}

/**
 * Seal every stored secret again with the current master key. Old secrets are read with
 * `previousMasterKeys`. Run it once after you change `masterKey`, then remove the old key:
 *
 * 1. `generateMasterKey()`, store it in your secret manager.
 * 2. Deploy with `masterKey: <new>`, `previousMasterKeys: [<old>]`.
 * 3. Run `await rotateMasterKey(qb)` (one transaction).
 * 4. Deploy without `previousMasterKeys`.
 */
export async function rotateMasterKey(qb: Quickben): Promise<RotationResult> {
  const state = getConnectionsOptions(qb);
  const [current] = state.keys;
  if (!current) throw new MasterKeyError("Set the connections masterKey before rotating");
  return qb.transaction(async (tx) => {
    const rows = await tx.db.find({ collection: CREDENTIALS, select: ["id", "secret"] });
    const result: RotationResult = { rotated: 0, current: 0 };
    for (const row of rows) {
      const sealed = row.secret;
      if (typeof sealed !== "string" || sealed === "") continue;
      if (sealedKeyId(sealed) === current.id) {
        result.current += 1;
        continue;
      }
      const secret = decryptSecret(sealed, state.keys);
      await tx.db.update({
        collection: CREDENTIALS,
        id: row.id as string,
        data: { secret: encryptSecret(secret, current) },
      });
      result.rotated += 1;
    }
    return result;
  });
}

/** A connection's state from its last test: `active`, `failed` or `untested`. */
export function connectionState(
  lastTest: { ok: boolean } | null,
): "active" | "failed" | "untested" {
  if (!lastTest) return "untested";
  return lastTest.ok ? "active" : "failed";
}

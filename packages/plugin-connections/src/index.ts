export {
  connectionState,
  findConnectionsByCapability,
  getConnection,
  listProviders,
  resolveCredential,
  rotateMasterKey,
  systemContext,
  testConnection,
  testCredential,
} from "./api";
export { connectionFields, credentialFields, lastTestSchema } from "./collections";
export {
  decryptSecret,
  encryptSecret,
  generateMasterKey,
  lastFour,
  MasterKeyError,
  parseMasterKey,
  sealedKeyId,
} from "./crypto";
export { ConnectionError } from "./errors";
export { anthropicLogo, apiLogo, geminiLogo, googleCloudLogo, httpLogo } from "./logos";
export { CONNECTIONS, CREDENTIALS, getConnectionsOptions } from "./options";
export { connections } from "./plugin";
export { CREDENTIAL_KINDS, defineProvider, providersByCategory } from "./provider";
export {
  ANTHROPIC_URL,
  anthropic,
  authHeaders,
  builtinProviders,
  gemini,
  GEMINI_URL,
  http,
  httpFields,
  llmFields,
  llmModelSchema,
  llmModelsSchema,
  OPENAI_URL,
  openaiCompatible,
  parseServiceAccount,
  pickModel,
  vertex,
  VERTEX_TEST_MODEL,
  vertexFields,
  vertexRoot,
} from "./providers";
export { REDACTED, redactKeys, redactSecrets, secretVariants } from "./redact";
export { checkSecret, secretLast4 } from "./secret";

export type {
  ConnectionRecord,
  CredentialRecord,
  FindByCapabilityOptions,
  GetConnectionOptions,
  ResolvedConnection,
  RotationResult,
  TestCredentialInput,
  TestOutcome,
} from "./api";
export type { ConnectionsCollection, CredentialsCollection, LastTest } from "./collections";
export type { MasterKey, MasterKeyInput } from "./crypto";
export type { ConnectionErrorReason } from "./errors";
export type { ConnectionsOptions, ResolvedConnections } from "./options";
export type { ConnectionsPlugin } from "./plugin";
export type {
  AnyProvider,
  CredentialKind,
  FetchLike,
  Provider,
  ProviderDefinition,
  ProviderLogo,
  ResolvedSecret,
  TestContext,
  TestResult,
} from "./provider";
export type { LlmModel, ServiceAccount } from "./providers";

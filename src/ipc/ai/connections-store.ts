import { randomUUID } from "node:crypto";
import Store from "electron-store";
import { decryptSecret, encryptSecret } from "@/ipc/security/secrets";
import {
  AI_API_PROVIDERS,
  AI_CLI_AGENT_PROVIDERS,
  type AiApiConnection,
  type AiApiProvider,
  type AiAuthStatus,
  type AiCliAgentConnection,
  type AiConnection,
  type AiConnectionProvider,
  type AiModel,
  type AiModelCapability,
  type AiPermissionScope,
  aiApiProviderSchema,
  aiCliAgentProviderSchema,
  aiConnectionProviderSchema,
  aiConnectionSchema,
  aiModelSchema,
  workspacePathSchema,
} from "@/shared/ai/connection-contracts";

export const DEFAULT_AI_CONNECTION_ID = "default";
const CONNECTIONS_STORAGE_VERSION = 1;
const LEGACY_MIGRATION_VERSION = 1;

type PermissionDecision = "allow" | "ask" | "deny";
export type AiPermissionPolicy = Partial<
  Record<AiPermissionScope, PermissionDecision>
>;

export interface LegacyAiSettings {
  apiKeys: Record<string, string>;
  customModels: Record<string, string[]>;
  model: string;
  ollamaBaseURL: string;
  ollamaModels?: string[];
  openaiCompatibleBaseURL: string;
  provider: string;
}

export interface CreateAiConnectionInput {
  apiKey?: string;
  baseUrl?: string;
  capabilities?: AiModelCapability[];
  defaultModelId?: string;
  executablePath?: string;
  models?: AiModel[];
  name?: string;
  permissionPolicy?: AiPermissionPolicy;
  provider: AiConnectionProvider;
  type?: "api" | "cli-agent";
  workspacePath?: string;
}

export interface UpdateAiConnectionInput {
  apiKey?: string;
  baseUrl?: string;
  capabilities?: AiModelCapability[];
  clearApiKey?: boolean;
  defaultModelId?: string;
  executablePath?: string;
  models?: AiModel[];
  name?: string;
  permissionPolicy?: AiPermissionPolicy;
  workspacePath?: string;
}

interface StoredAiConnection {
  permissionPolicy: AiPermissionPolicy;
  profile: AiConnection;
}

interface ConnectionsStoreData {
  connections: StoredAiConnection[];
  defaultConnectionId: string | null;
  legacyMigrationVersion: number;
  version: number;
}

interface ConnectionSecrets {
  values: Record<string, string>;
}

const PROVIDER_LABELS: Record<AiConnectionProvider, string> = {
  anthropic: "Anthropic",
  "claude-code": "Claude Code",
  codex: "Codex",
  google: "Google",
  "oh-my-pi": "Oh My Pi",
  ollama: "Ollama",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-Compatible",
  opencode: "OpenCode",
  pi: "Pi",
};

const API_PROVIDERS_REQUIRING_KEYS = new Set<AiApiProvider>([
  "openai",
  "anthropic",
  "google",
]);

const connectionStore = new Store<ConnectionsStoreData>({
  defaults: {
    connections: [],
    defaultConnectionId: null,
    legacyMigrationVersion: 0,
    version: CONNECTIONS_STORAGE_VERSION,
  },
  name: "ai-connections",
});

// Keep encrypted credentials in a separate store so profile serialization can
// never accidentally include a secret, even if a profile is copied wholesale.
const connectionSecretsStore = new Store<ConnectionSecrets>({
  defaults: { values: {} },
  name: "ai-connection-secrets",
});

function isApiProvider(
  provider: AiConnectionProvider
): provider is AiApiProvider {
  return (AI_API_PROVIDERS as readonly string[]).includes(provider);
}

function isCliAgentProvider(
  provider: AiConnectionProvider
): provider is (typeof AI_CLI_AGENT_PROVIDERS)[number] {
  return (AI_CLI_AGENT_PROVIDERS as readonly string[]).includes(provider);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (!isValidHttpUrl(trimmed)) {
    throw new Error("AI connection base URL must be a valid http(s) URL.");
  }
  return trimmed;
}

function validateWorkspacePath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return;
  }
  return workspacePathSchema.parse(value);
}

function normalizeModels(models: AiModel[] | undefined): AiModel[] {
  const normalized: AiModel[] = [];
  const seen = new Set<string>();

  for (const model of models ?? []) {
    const parsed = aiModelSchema.parse(model);
    if (seen.has(parsed.id)) {
      continue;
    }
    seen.add(parsed.id);
    normalized.push(parsed);
  }

  return normalized;
}

function addDefaultModel(
  models: AiModel[],
  modelId: string | undefined
): AiModel[] {
  if (!modelId || models.some((model) => model.id === modelId)) {
    return models;
  }
  return [
    ...models,
    {
      capabilities: [],
      displayName: modelId,
      id: modelId,
      isCustom: true,
      isFavorite: false,
    },
  ];
}

function normalizePermissionPolicy(
  policy: AiPermissionPolicy | undefined
): AiPermissionPolicy {
  if (!policy) {
    return {};
  }

  const normalized: AiPermissionPolicy = {};
  for (const [scope, decision] of Object.entries(policy)) {
    if (
      !(
        ["database", "editor", "workspace", "terminal", "credentials"].includes(
          scope
        ) && ["allow", "ask", "deny"].includes(decision)
      )
    ) {
      throw new Error(`Invalid AI permission policy entry '${scope}'.`);
    }
    normalized[scope as AiPermissionScope] = decision as PermissionDecision;
  }
  return normalized;
}

function getDefaultData(): ConnectionsStoreData {
  return {
    connections: [],
    defaultConnectionId: null,
    legacyMigrationVersion: 0,
    version: CONNECTIONS_STORAGE_VERSION,
  };
}

function parseStoredConnection(value: unknown): StoredAiConnection | undefined {
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const rawProfile =
    record.profile && typeof record.profile === "object"
      ? record.profile
      : Object.fromEntries(
          Object.entries(record).filter(([key]) => key !== "permissionPolicy")
        );
  const profileResult = aiConnectionSchema.safeParse(rawProfile);
  if (!profileResult.success) {
    return;
  }

  try {
    return {
      permissionPolicy: normalizePermissionPolicy(
        (record.permissionPolicy ?? {}) as AiPermissionPolicy
      ),
      profile: profileResult.data,
    };
  } catch {
    // Invalid permission metadata is ignored and replaced by an empty policy.
  }
}

function readData(): ConnectionsStoreData {
  const raw = connectionStore.store as unknown;
  if (!raw || typeof raw !== "object") {
    return getDefaultData();
  }

  const record = raw as Record<string, unknown>;
  const rawConnections = Array.isArray(record.connections)
    ? record.connections
    : [];
  const connections = rawConnections.flatMap((connection) => {
    const parsed = parseStoredConnection(connection);
    return parsed ? [parsed] : [];
  });
  const rawDefaultId = record.defaultConnectionId;
  const defaultConnectionId =
    typeof rawDefaultId === "string" &&
    connections.some((connection) => connection.profile.id === rawDefaultId)
      ? rawDefaultId
      : null;

  return {
    connections,
    defaultConnectionId,
    legacyMigrationVersion:
      typeof record.legacyMigrationVersion === "number"
        ? record.legacyMigrationVersion
        : 0,
    version:
      typeof record.version === "number"
        ? record.version
        : CONNECTIONS_STORAGE_VERSION,
  };
}

function writeData(data: ConnectionsStoreData): void {
  connectionStore.set("version", data.version);
  connectionStore.set("legacyMigrationVersion", data.legacyMigrationVersion);
  connectionStore.set("defaultConnectionId", data.defaultConnectionId);
  connectionStore.set("connections", data.connections);
}

function readSecrets(): Record<string, string> {
  const values = connectionSecretsStore.get("values", {});
  if (!values || typeof values !== "object") {
    return {};
  }
  return { ...values };
}

function writeSecrets(values: Record<string, string>): void {
  connectionSecretsStore.set("values", values);
}

function secretKey(connectionId: string, provider: AiApiProvider): string {
  return `${connectionId}:${provider}`;
}

function setConnectionApiKeyInternal(
  connectionId: string,
  provider: AiApiProvider,
  key: string,
  overwrite = true
): void {
  const values = readSecrets();
  const keyName = secretKey(connectionId, provider);
  if (!overwrite && values[keyName]) {
    return;
  }

  if (key) {
    values[keyName] = encryptSecret(key);
  } else {
    delete values[keyName];
  }
  writeSecrets(values);
}

function getConnectionApiKeyInternal(
  connectionId: string,
  provider: AiApiProvider
): string {
  return decryptSecret(readSecrets()[secretKey(connectionId, provider)] ?? "");
}

function removeConnectionSecrets(connectionId: string): void {
  const values = readSecrets();
  const prefix = `${connectionId}:`;
  const remaining = Object.fromEntries(
    Object.entries(values).filter(([key]) => !key.startsWith(prefix))
  );
  writeSecrets(remaining);
}

function deriveAuthStatus(
  provider: AiConnectionProvider,
  baseUrl: string | undefined,
  apiKey: string
): AiAuthStatus {
  if (isApiProvider(provider) && API_PROVIDERS_REQUIRING_KEYS.has(provider)) {
    return apiKey ? "authenticated" : "not-configured";
  }
  if (provider === "openai-compatible") {
    return baseUrl ? "authenticated" : "not-configured";
  }
  return "not-configured";
}

function getStoredConnection(
  data: ConnectionsStoreData,
  connectionId: string
): StoredAiConnection {
  const connection = data.connections.find(
    (candidate) => candidate.profile.id === connectionId
  );
  if (!connection) {
    throw new Error(`AI connection '${connectionId}' was not found.`);
  }
  return connection;
}

function toPublicConnection(connection: StoredAiConnection): AiConnection {
  return aiConnectionSchema.parse(connection.profile);
}

function getProfileModelIds(models: AiModel[]): Set<string> {
  return new Set(models.map((model) => model.id));
}

function getLegacyProvider(legacy: LegacyAiSettings): AiApiProvider {
  const parsed = aiApiProviderSchema.safeParse(legacy.provider);
  return parsed.success ? parsed.data : "openai";
}

function getLegacyModels(
  legacy: LegacyAiSettings,
  provider: AiApiProvider
): AiModel[] {
  const ids = [
    ...(legacy.customModels[provider] ?? []),
    ...(provider === "ollama" ? (legacy.ollamaModels ?? []) : []),
  ];
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  return uniqueIds.map((id) => ({
    capabilities: [],
    displayName: id,
    id,
    isCustom: true,
    isFavorite: false,
  }));
}

function getLegacyBaseUrl(
  legacy: LegacyAiSettings,
  provider: AiApiProvider
): string | undefined {
  try {
    if (provider === "openai-compatible") {
      return validateBaseUrl(legacy.openaiCompatibleBaseURL);
    }
    if (provider === "ollama") {
      return validateBaseUrl(legacy.ollamaBaseURL);
    }
  } catch {
    // Keep an invalid legacy URL readable without blocking the migration.
  }
}

function createLegacyDefaultProfile(
  legacy: LegacyAiSettings,
  apiKey = ""
): StoredAiConnection {
  const provider = getLegacyProvider(legacy);
  const modelId = legacy.model.trim() || undefined;
  const baseUrl = getLegacyBaseUrl(legacy, provider);
  const models = addDefaultModel(
    normalizeModels(getLegacyModels(legacy, provider)),
    modelId
  );
  const profile: AiApiConnection = {
    authStatus: deriveAuthStatus(provider, baseUrl, apiKey),
    baseUrl,
    capabilities: [],
    defaultModelId: modelId,
    id: DEFAULT_AI_CONNECTION_ID,
    models,
    name: "Default",
    provider,
    type: "api",
  };

  return { permissionPolicy: {}, profile };
}

function writeLegacySecrets(legacy: LegacyAiSettings): void {
  for (const provider of AI_API_PROVIDERS) {
    const key = legacy.apiKeys[provider] ?? "";
    if (key) {
      setConnectionApiKeyInternal(
        DEFAULT_AI_CONNECTION_ID,
        provider,
        key,
        false
      );
    }
  }
}

/**
 * Create the stable default connection from the pre-profile AI settings.
 * The migration marker is written last so a partial migration can safely be
 * retried without creating another profile or deleting a secret.
 */
export function migrateLegacyAiSettings(
  legacy: LegacyAiSettings
): AiConnection {
  const data = readData();
  let defaultConnection = data.connections.find(
    (connection) => connection.profile.id === DEFAULT_AI_CONNECTION_ID
  );

  if (data.legacyMigrationVersion < LEGACY_MIGRATION_VERSION) {
    if (!defaultConnection) {
      defaultConnection = createLegacyDefaultProfile(
        legacy,
        legacy.apiKeys[getLegacyProvider(legacy)] ?? ""
      );
      data.connections.push(defaultConnection);
    }

    if (!data.defaultConnectionId) {
      data.defaultConnectionId = DEFAULT_AI_CONNECTION_ID;
    }

    writeLegacySecrets(legacy);
    data.version = CONNECTIONS_STORAGE_VERSION;
    data.legacyMigrationVersion = LEGACY_MIGRATION_VERSION;
    writeData(data);
  }

  if (!defaultConnection) {
    const currentData = readData();
    defaultConnection = currentData.connections.find(
      (connection) => connection.profile.id === currentData.defaultConnectionId
    );
  }

  if (!defaultConnection) {
    throw new Error("The default AI connection could not be created.");
  }

  return toPublicConnection(defaultConnection);
}

/** Keep the legacy global settings and the compatibility profile in sync. */
export function syncLegacyAiSettings(legacy: LegacyAiSettings): void {
  const data = readData();
  const defaultIndex = data.connections.findIndex(
    (connection) => connection.profile.id === DEFAULT_AI_CONNECTION_ID
  );
  if (defaultIndex < 0) {
    migrateLegacyAiSettings(legacy);
    return;
  }

  const provider = getLegacyProvider(legacy);
  const apiKey = legacy.apiKeys[provider] ?? "";
  const next = createLegacyDefaultProfile(legacy, apiKey);
  next.permissionPolicy = data.connections[defaultIndex].permissionPolicy;
  data.connections[defaultIndex] = next;
  data.defaultConnectionId ??= DEFAULT_AI_CONNECTION_ID;
  writeLegacySecrets(legacy);
  writeData(data);
}

export function listConnections(): AiConnection[] {
  return readData().connections.map(toPublicConnection);
}

export function getConnection(connectionId: string): AiConnection | undefined {
  const connection = readData().connections.find(
    (candidate) => candidate.profile.id === connectionId
  );
  return connection ? toPublicConnection(connection) : undefined;
}

export function getDefaultConnectionId(): string | undefined {
  return readData().defaultConnectionId ?? undefined;
}

export function getDefaultConnection(): AiConnection | undefined {
  const data = readData();
  if (!data.defaultConnectionId) {
    return;
  }
  const connection = data.connections.find(
    (candidate) => candidate.profile.id === data.defaultConnectionId
  );
  return connection ? toPublicConnection(connection) : undefined;
}

function buildProfile(
  input: CreateAiConnectionInput,
  id: string,
  apiKey: string
): StoredAiConnection {
  const provider = aiConnectionProviderSchema.parse(input.provider);
  let inferredType: "api" | "cli-agent" | undefined;
  if (isApiProvider(provider)) {
    inferredType = "api";
  } else if (isCliAgentProvider(provider)) {
    inferredType = "cli-agent";
  }
  const type = input.type ?? inferredType;
  if (
    !type ||
    (type === "api" && !isApiProvider(provider)) ||
    (type === "cli-agent" && !isCliAgentProvider(provider))
  ) {
    throw new Error(
      `Provider '${provider}' is incompatible with connection type '${type ?? "unknown"}'.`
    );
  }

  const name = input.name?.trim() || PROVIDER_LABELS[provider];
  const models = addDefaultModel(
    normalizeModels(input.models),
    input.defaultModelId?.trim()
  );
  const defaultModelId = input.defaultModelId?.trim() || undefined;
  const baseUrl = type === "api" ? validateBaseUrl(input.baseUrl) : undefined;
  const capabilities = input.capabilities ?? [];

  if (type === "api") {
    const apiProvider = aiApiProviderSchema.parse(provider);
    const profile: AiApiConnection = {
      authStatus: deriveAuthStatus(apiProvider, baseUrl, apiKey),
      baseUrl,
      capabilities,
      defaultModelId,
      id,
      models,
      name,
      provider: apiProvider,
      type,
    };
    return {
      permissionPolicy: normalizePermissionPolicy(input.permissionPolicy),
      profile,
    };
  }

  const cliProvider = aiCliAgentProviderSchema.parse(provider);
  const profile: AiCliAgentConnection = {
    authStatus: "not-configured",
    capabilities,
    executablePath: input.executablePath?.trim() || undefined,
    id,
    models,
    name,
    provider: cliProvider,
    type,
    workspacePath: validateWorkspacePath(input.workspacePath),
  };
  return {
    permissionPolicy: normalizePermissionPolicy(input.permissionPolicy),
    profile,
  };
}

export function createConnection(input: CreateAiConnectionInput): AiConnection {
  const id = randomUUID();
  const apiKey = input.apiKey ?? "";
  const connection = buildProfile(input, id, apiKey);
  const data = readData();
  data.connections.push(connection);
  if (!data.defaultConnectionId) {
    data.defaultConnectionId = id;
  }
  writeData(data);

  if (connection.profile.type === "api" && apiKey) {
    setConnectionApiKeyInternal(id, connection.profile.provider, apiKey);
  }

  return toPublicConnection(connection);
}

function getUpdatedModelState(
  profile: AiConnection,
  patch: UpdateAiConnectionInput
): { defaultModelId: string | undefined; models: AiModel[] } {
  const defaultModelId =
    patch.defaultModelId === undefined
      ? profile.defaultModelId
      : patch.defaultModelId.trim() || undefined;
  const models = addDefaultModel(
    patch.models ? normalizeModels(patch.models) : profile.models,
    defaultModelId
  );
  if (defaultModelId && !getProfileModelIds(models).has(defaultModelId)) {
    throw new Error(
      `Model '${defaultModelId}' is not available for this AI connection.`
    );
  }
  return { defaultModelId, models };
}

function getUpdatedName(
  profile: AiConnection,
  patch: UpdateAiConnectionInput
): string {
  const name = patch.name === undefined ? profile.name : patch.name.trim();
  if (!name) {
    throw new Error("AI connection name must not be empty.");
  }
  return name;
}

function getUpdatedPermissionPolicy(
  connection: StoredAiConnection,
  patch: UpdateAiConnectionInput
): AiPermissionPolicy {
  return patch.permissionPolicy
    ? normalizePermissionPolicy(patch.permissionPolicy)
    : connection.permissionPolicy;
}

function persistUpdatedConnection(
  data: ConnectionsStoreData,
  current: StoredAiConnection,
  next: StoredAiConnection
): void {
  data.connections[data.connections.indexOf(current)] = next;
  writeData(data);
}

function updateApiConnection(
  data: ConnectionsStoreData,
  current: StoredAiConnection,
  patch: UpdateAiConnectionInput,
  name: string,
  modelState: { defaultModelId: string | undefined; models: AiModel[] },
  connectionId: string
): AiConnection {
  const { profile } = current;
  if (profile.type !== "api") {
    throw new Error("Expected an API connection.");
  }
  const baseUrl =
    patch.baseUrl === undefined
      ? profile.baseUrl
      : validateBaseUrl(patch.baseUrl);
  const apiKey = patch.clearApiKey
    ? ""
    : (patch.apiKey ??
      getConnectionApiKeyInternal(connectionId, profile.provider));
  const nextConnection: StoredAiConnection = {
    permissionPolicy: getUpdatedPermissionPolicy(current, patch),
    profile: {
      ...profile,
      authStatus: deriveAuthStatus(profile.provider, baseUrl, apiKey),
      baseUrl,
      capabilities: patch.capabilities ?? profile.capabilities,
      defaultModelId: modelState.defaultModelId,
      models: modelState.models,
      name,
    },
  };
  persistUpdatedConnection(data, current, nextConnection);

  if (patch.apiKey !== undefined || patch.clearApiKey) {
    setConnectionApiKeyInternal(
      connectionId,
      profile.provider,
      patch.clearApiKey ? "" : (patch.apiKey ?? "")
    );
  }
  return toPublicConnection(nextConnection);
}

function updateCliConnection(
  data: ConnectionsStoreData,
  current: StoredAiConnection,
  patch: UpdateAiConnectionInput,
  name: string,
  modelState: { defaultModelId: string | undefined; models: AiModel[] }
): AiConnection {
  const { profile } = current;
  if (profile.type !== "cli-agent") {
    throw new Error("Expected a CLI agent connection.");
  }
  const nextConnection: StoredAiConnection = {
    permissionPolicy: getUpdatedPermissionPolicy(current, patch),
    profile: {
      ...profile,
      capabilities: patch.capabilities ?? profile.capabilities,
      defaultModelId: modelState.defaultModelId,
      executablePath:
        patch.executablePath === undefined
          ? profile.executablePath
          : patch.executablePath.trim() || undefined,
      models: modelState.models,
      name,
      workspacePath:
        patch.workspacePath === undefined
          ? profile.workspacePath
          : validateWorkspacePath(patch.workspacePath),
    },
  };
  persistUpdatedConnection(data, current, nextConnection);
  return toPublicConnection(nextConnection);
}

export function updateConnection(
  connectionId: string,
  patch: UpdateAiConnectionInput
): AiConnection {
  const data = readData();
  const current = getStoredConnection(data, connectionId);
  const { profile } = current;
  const name = getUpdatedName(profile, patch);
  const modelState = getUpdatedModelState(profile, patch);

  if (profile.type === "api") {
    return updateApiConnection(
      data,
      current,
      patch,
      name,
      modelState,
      connectionId
    );
  }
  return updateCliConnection(data, current, patch, name, modelState);
}

export function deleteConnection(connectionId: string): void {
  const data = readData();
  getStoredConnection(data, connectionId);
  if (data.connections.length === 1) {
    throw new Error("The last AI connection cannot be deleted.");
  }

  data.connections = data.connections.filter(
    (connection) => connection.profile.id !== connectionId
  );
  if (data.defaultConnectionId === connectionId) {
    data.defaultConnectionId = data.connections[0]?.profile.id ?? null;
  }
  writeData(data);
  removeConnectionSecrets(connectionId);
}

export function setConnectionModels(
  connectionId: string,
  models: AiModel[]
): AiConnection {
  return updateConnection(connectionId, { models });
}

export function setDefaultModel(
  connectionId: string,
  modelId: string
): AiConnection {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    throw new Error("AI connection model ID must not be empty.");
  }
  return updateConnection(connectionId, { defaultModelId: normalizedModelId });
}

export function setPermissionPolicy(
  connectionId: string,
  policy: AiPermissionPolicy
): AiConnection {
  return updateConnection(connectionId, { permissionPolicy: policy });
}

/** Store an API key without returning it as part of the connection profile. */
export function setConnectionApiKey(
  connectionId: string,
  key: string
): AiConnection {
  const data = readData();
  const connection = getStoredConnection(data, connectionId);
  if (connection.profile.type !== "api") {
    throw new Error("CLI agent connections do not accept API keys.");
  }

  setConnectionApiKeyInternal(connectionId, connection.profile.provider, key);
  const nextProfile: AiApiConnection = {
    ...connection.profile,
    authStatus: deriveAuthStatus(
      connection.profile.provider,
      connection.profile.baseUrl,
      key
    ),
  };
  const nextConnection = { ...connection, profile: nextProfile };
  data.connections[data.connections.indexOf(connection)] = nextConnection;
  writeData(data);
  return toPublicConnection(nextConnection);
}

/** Read a credential only inside the main process for a selected profile. */
export function getConnectionApiKey(connectionId: string): string {
  const connection = getStoredConnection(readData(), connectionId);
  if (!isApiProvider(connection.profile.provider)) {
    return "";
  }
  return getConnectionApiKeyInternal(connectionId, connection.profile.provider);
}

/**
 * Test-only-safe metadata snapshot. It contains encrypted values only and is
 * useful to assert persistence without ever returning a plaintext secret.
 */
export function getSerializedConnectionMetadata(): string {
  return JSON.stringify(connectionStore.store);
}

import z from "zod";

/** Providers supported by a saved AI connection profile. */
export const AI_CONNECTION_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "ollama",
  "claude-code",
  "codex",
  "pi",
  "oh-my-pi",
  "opencode",
] as const;

export type AiConnectionProvider = (typeof AI_CONNECTION_PROVIDERS)[number];

export const aiConnectionProviderSchema = z.enum(AI_CONNECTION_PROVIDERS);

export const AI_API_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "ollama",
] as const;

export type AiApiProvider = (typeof AI_API_PROVIDERS)[number];

export const aiApiProviderSchema = z.enum(AI_API_PROVIDERS);

export const AI_CLI_AGENT_PROVIDERS = [
  "claude-code",
  "codex",
  "pi",
  "oh-my-pi",
  "opencode",
] as const;

export type AiCliAgentProvider = (typeof AI_CLI_AGENT_PROVIDERS)[number];

export const aiCliAgentProviderSchema = z.enum(AI_CLI_AGENT_PROVIDERS);

/** Capabilities advertised by a model or connection. */
export const AI_MODEL_CAPABILITIES = [
  "tools",
  "terminal",
  "files",
  "reasoning",
] as const;

export type AiModelCapability = (typeof AI_MODEL_CAPABILITIES)[number];

export const aiModelCapabilitySchema = z.enum(AI_MODEL_CAPABILITIES);
export const aiModelCapabilitiesSchema = z
  .array(aiModelCapabilitySchema)
  .default([]);

/** Authentication state exposed to the renderer. It intentionally contains no secrets. */
export const AI_AUTH_STATUSES = [
  "authenticated",
  "not-configured",
  "error",
] as const;

export type AiAuthStatus = (typeof AI_AUTH_STATUSES)[number];

export const aiAuthStatusSchema = z.enum(AI_AUTH_STATUSES);

/** Permission categories that can be granted to an AI session. */
export const AI_PERMISSION_SCOPES = [
  "database",
  "editor",
  "workspace",
  "terminal",
  "credentials",
] as const;

export type AiPermissionScope = (typeof AI_PERMISSION_SCOPES)[number];

export const aiPermissionScopeSchema = z.enum(AI_PERMISSION_SCOPES);
export const aiPermissionScopesSchema = z
  .array(aiPermissionScopeSchema)
  .default([]);

const identifierSchema = z.string().trim().min(1, "must not be empty");
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WORKSPACE_PATH_SEPARATOR_PATTERN = /[\\/]+/;

/**
 * Workspace paths must be absolute so a session cannot silently inherit the
 * process working directory. Parent traversal is rejected at the contract
 * boundary; finer-grained root checks belong to the tool layer.
 */
export const workspacePathSchema = z
  .string()
  .trim()
  .min(1, "workspace path must not be empty")
  .refine((value) => {
    if (value.includes("\0")) {
      return false;
    }

    const isPosixAbsolute = value.startsWith("/");
    const isWindowsAbsolute = WINDOWS_ABSOLUTE_PATH_PATTERN.test(value);
    const isUncAbsolute = value.startsWith("\\\\");
    if (!(isPosixAbsolute || isWindowsAbsolute || isUncAbsolute)) {
      return false;
    }

    return !value.split(WORKSPACE_PATH_SEPARATOR_PATTERN).includes("..");
  }, "workspace path must be an absolute path without parent traversal");

export const aiModelSchema = z
  .object({
    capabilities: aiModelCapabilitiesSchema,
    displayName: identifierSchema,
    id: identifierSchema,
    isCustom: z.boolean().default(false),
    isFavorite: z.boolean().default(false),
  })
  .strict();

export type AiModel = z.infer<typeof aiModelSchema>;

const aiConnectionCommonSchema = z
  .object({
    authStatus: aiAuthStatusSchema.default("not-configured"),
    capabilities: aiModelCapabilitiesSchema,
    defaultModelId: identifierSchema.optional(),
    id: identifierSchema,
    models: z.array(aiModelSchema).default([]),
    name: identifierSchema,
  })
  .strict();

export const aiApiConnectionSchema = aiConnectionCommonSchema
  .extend({
    baseUrl: z.string().url().optional(),
    provider: aiApiProviderSchema,
    type: z.literal("api"),
  })
  .strict();

export type AiApiConnection = z.infer<typeof aiApiConnectionSchema>;

export const aiCliAgentConnectionSchema = aiConnectionCommonSchema
  .extend({
    executablePath: identifierSchema.optional(),
    provider: aiCliAgentProviderSchema,
    type: z.literal("cli-agent"),
    workspacePath: workspacePathSchema.optional(),
  })
  .strict();

export type AiCliAgentConnection = z.infer<typeof aiCliAgentConnectionSchema>;

/** Public connection profile. No API key, token, password, or secret is accepted. */
export const aiConnectionSchema = z.discriminatedUnion("type", [
  aiApiConnectionSchema,
  aiCliAgentConnectionSchema,
]);

export type AiConnection = z.infer<typeof aiConnectionSchema>;

export const aiSessionSourceSchema = z.enum(["api", "cli-agent"]);
export type AiSessionSource = z.infer<typeof aiSessionSourceSchema>;

/** Optional metadata attached to streaming lifecycle events. */
export const aiSessionMetadataSchema = z
  .object({
    connectionId: identifierSchema.optional(),
    modelId: identifierSchema.optional(),
    sessionId: identifierSchema.optional(),
    source: aiSessionSourceSchema.optional(),
  })
  .strict();

export type AiSessionMetadata = z.infer<typeof aiSessionMetadataSchema>;

/** Scope binding an agent session to one conversation, connection, model, and workspace. */
export const aiSessionScopeSchema = z
  .object({
    connectionId: identifierSchema,
    conversationId: identifierSchema,
    modelId: identifierSchema,
    permissions: aiPermissionScopesSchema,
    workspacePath: workspacePathSchema.optional(),
  })
  .strict();

export type AiSessionScope = z.infer<typeof aiSessionScopeSchema>;

// PascalCase aliases make the runtime contracts discoverable alongside their types.
export const AiConnectionSchema = aiConnectionSchema;
export const AiApiConnectionSchema = aiApiConnectionSchema;
export const AiCliAgentConnectionSchema = aiCliAgentConnectionSchema;
export const AiModelSchema = aiModelSchema;
export const AiSessionMetadataSchema = aiSessionMetadataSchema;
export const AiSessionScopeSchema = aiSessionScopeSchema;
export const AiPermissionScopeSchema = aiPermissionScopeSchema;

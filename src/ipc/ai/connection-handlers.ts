import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { getApiProviderAdapter } from "@/ipc/ai/adapters/api-provider-adapter";
import {
  type CreateAiConnectionInput,
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  setConnectionModels,
  setDefaultModel,
  type UpdateAiConnectionInput,
  updateConnection,
} from "@/ipc/ai/connections-store";
import {
  type AiApiConnection,
  type AiConnection,
  type AiModel,
  aiApiConnectionSchema,
  aiAuthStatusSchema,
  aiConnectionProviderSchema,
  aiConnectionSchema,
  aiModelCapabilitiesSchema,
  aiModelSchema,
  aiPermissionScopeSchema,
  workspacePathSchema,
} from "@/shared/ai/connection-contracts";

const aiPermissionDecisionSchema = z.enum(["allow", "ask", "deny"]);
const aiPermissionPolicySchema = z.partialRecord(
  aiPermissionScopeSchema,
  aiPermissionDecisionSchema
);
const connectionIdSchema = z
  .string()
  .trim()
  .min(1, "connection ID must not be empty");

export const createAiConnectionInputSchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    capabilities: aiModelCapabilitiesSchema.optional(),
    defaultModelId: z.string().trim().min(1).optional(),
    executablePath: z.string().trim().min(1).optional(),
    models: z.array(aiModelSchema).optional(),
    name: z.string().trim().min(1).optional(),
    permissionPolicy: aiPermissionPolicySchema.optional(),
    provider: aiConnectionProviderSchema,
    type: z.enum(["api", "cli-agent"]).optional(),
    workspacePath: workspacePathSchema.optional(),
  })
  .strict();

export const updateAiConnectionInputSchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    capabilities: aiModelCapabilitiesSchema.optional(),
    clearApiKey: z.boolean().optional(),
    defaultModelId: z.string().trim().min(1).optional(),
    executablePath: z.string().trim().min(1).optional(),
    models: z.array(aiModelSchema).optional(),
    name: z.string().trim().min(1).optional(),
    permissionPolicy: aiPermissionPolicySchema.optional(),
    workspacePath: workspacePathSchema.optional(),
  })
  .strict();

const connectionIdInputSchema = z
  .object({ connectionId: connectionIdSchema })
  .strict();
const setDefaultModelInputSchema = connectionIdInputSchema
  .extend({ modelId: z.string().trim().min(1) })
  .strict();
const setConnectionModelsInputSchema = connectionIdInputSchema
  .extend({ models: z.array(aiModelSchema) })
  .strict();

export type CreateAiConnectionRequest = z.infer<
  typeof createAiConnectionInputSchema
>;
export type UpdateAiConnectionRequest = z.infer<
  typeof updateAiConnectionInputSchema
>;

function mapHandlerError(
  error: unknown,
  fallback: string,
  code: "BAD_REQUEST" | "NOT_FOUND" | "METHOD_NOT_SUPPORTED" = "BAD_REQUEST"
): never {
  if (error instanceof ORPCError) {
    throw error;
  }

  throw new ORPCError(code, {
    message: error instanceof Error && error.message ? error.message : fallback,
  });
}

function toPublicConnection(connection: AiConnection): AiConnection {
  return aiConnectionSchema.parse(connection);
}

function toPublicModels(models: AiModel[]): AiModel[] {
  return models.map((model) => aiModelSchema.parse(model));
}

function getConnectionOrThrow(connectionId: string): AiConnection {
  const connection = getConnection(connectionId);
  if (!connection) {
    throw new ORPCError("NOT_FOUND", {
      message: `AI connection '${connectionId}' was not found.`,
    });
  }
  return toPublicConnection(connection);
}

function getApiConnectionOrThrow(connectionId: string): AiApiConnection {
  const connection = getConnectionOrThrow(connectionId);
  if (connection.type !== "api") {
    throw new ORPCError("METHOD_NOT_SUPPORTED", {
      message:
        "Connection testing and model discovery are only available for API connections.",
    });
  }
  return aiApiConnectionSchema.parse(connection);
}

export const aiListConnections = os.handler(() => {
  try {
    return listConnections().map(toPublicConnection);
  } catch (error) {
    return mapHandlerError(error, "Failed to list AI connections");
  }
});

export const aiGetConnection = os
  .input(connectionIdInputSchema)
  .handler(({ input }) => {
    try {
      return getConnectionOrThrow(input.connectionId);
    } catch (error) {
      return mapHandlerError(error, "Failed to get AI connection");
    }
  });

export const aiCreateConnection = os
  .input(createAiConnectionInputSchema)
  .handler(({ input }) => {
    try {
      return toPublicConnection(
        createConnection(input as CreateAiConnectionInput)
      );
    } catch (error) {
      return mapHandlerError(error, "Failed to create AI connection");
    }
  });

export const aiUpdateConnection = os
  .input(
    connectionIdInputSchema.extend({
      patch: updateAiConnectionInputSchema,
    })
  )
  .handler(({ input }) => {
    try {
      return toPublicConnection(
        updateConnection(
          input.connectionId,
          input.patch as UpdateAiConnectionInput
        )
      );
    } catch (error) {
      return mapHandlerError(error, "Failed to update AI connection");
    }
  });

export const aiDeleteConnection = os
  .input(connectionIdInputSchema)
  .handler(({ input }) => {
    try {
      deleteConnection(input.connectionId);
      return { success: true };
    } catch (error) {
      return mapHandlerError(error, "Failed to delete AI connection");
    }
  });

export const aiSetDefaultModel = os
  .input(setDefaultModelInputSchema)
  .handler(({ input }) => {
    try {
      return toPublicConnection(
        setDefaultModel(input.connectionId, input.modelId)
      );
    } catch (error) {
      return mapHandlerError(error, "Failed to set the default AI model");
    }
  });

export const aiSetConnectionModels = os
  .input(setConnectionModelsInputSchema)
  .handler(({ input }) => {
    try {
      return toPublicConnection(
        setConnectionModels(input.connectionId, input.models)
      );
    } catch (error) {
      return mapHandlerError(error, "Failed to update AI connection models");
    }
  });

export const aiListConnectionModels = os
  .input(connectionIdInputSchema)
  .handler(({ input }) => {
    try {
      const connection = getConnectionOrThrow(input.connectionId);
      return {
        connectionId: connection.id,
        models: toPublicModels(connection.models),
      };
    } catch (error) {
      return mapHandlerError(error, "Failed to list AI connection models");
    }
  });

export const aiTestConnection = os
  .input(connectionIdInputSchema)
  .handler(async ({ input }) => {
    try {
      const connection = getApiConnectionOrThrow(input.connectionId);
      const result = await getApiProviderAdapter().authenticate(connection.id);
      return {
        connectionId: connection.id,
        message: result.message,
        status: aiAuthStatusSchema.parse(result.status),
      };
    } catch (error) {
      return mapHandlerError(error, "Failed to test AI connection");
    }
  });

export const aiDiscoverModels = os
  .input(connectionIdInputSchema)
  .handler(async ({ input }) => {
    try {
      const connection = getApiConnectionOrThrow(input.connectionId);
      const models = await getApiProviderAdapter().listModels(connection.id);
      return {
        connectionId: connection.id,
        models: toPublicModels(models),
      };
    } catch (error) {
      return mapHandlerError(error, "Failed to discover AI connection models");
    }
  });

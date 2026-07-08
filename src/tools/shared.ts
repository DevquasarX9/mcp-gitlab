import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AliasMap, AppConfig } from "../config.js";
import type { GitLabClient } from "../gitlab/client.js";
import { buildUserFacingError, GuardrailError } from "../gitlab/errors.js";
import type { JsonMap } from "../gitlab/types.js";
import {
  ACCESS_LEVEL,
  assertGroupAllowed,
  assertDestructiveEnabled,
  assertProjectAllowed,
  assertWriteEnabled,
  type SafetyLevel
} from "../security/guards.js";
import { toolFailure, toolSuccess } from "../utils/result.js";
import { inferToolCategory, shouldRegisterTool, type ToolCategory } from "./profiles.js";

export interface ToolDeps {
  readonly server: McpServer;
  readonly client: GitLabClient;
  readonly config: AppConfig;
}

export interface ToolExecutionContext {
  readonly client: GitLabClient;
  readonly config: AppConfig;
  readonly resolveProjectId: (projectId: string) => string;
  readonly resolveGroupId: (groupId: string) => string;
  readonly requireProject: (projectId: string) => Promise<JsonMap>;
  readonly requireGroup: (groupId: string) => Promise<JsonMap>;
}

interface ToolDefinition<TSchema extends z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly safety: SafetyLevel;
  readonly category?: ToolCategory;
  readonly profiles?: readonly AppConfig["toolProfile"][];
  readonly inputSchema: TSchema;
  readonly handler: (
    args: z.output<z.ZodObject<TSchema>>,
    context: ToolExecutionContext
  ) => Promise<unknown>;
}

export function registerTool<TSchema extends z.ZodRawShape>(
  deps: ToolDeps,
  definition: ToolDefinition<TSchema>
): void {
  const category = definition.category ?? inferToolCategory(definition.name);
  const decision = shouldRegisterTool(
    {
      name: definition.name,
      safety: definition.safety,
      category,
      profiles: definition.profiles
    },
    deps.config
  );

  if (!decision.register) {
    return;
  }

  deps.server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema as z.ZodRawShape,
      annotations: {
        title: definition.title,
        readOnlyHint: definition.safety === "read-only",
        destructiveHint: definition.safety === "destructive",
        idempotentHint: definition.safety !== "safe-write",
        openWorldHint: true
      }
    },
    async (args: Record<string, unknown>) => {
      const normalizedArgs = resolveToolArgumentAliases(args, deps.config);
      const context: ToolExecutionContext = {
        client: deps.client,
        config: deps.config,
        resolveProjectId: (projectId: string) =>
          resolveConfiguredAlias(projectId, deps.config.projectAliases, "project"),
        resolveGroupId: (groupId: string) =>
          resolveConfiguredAlias(groupId, deps.config.groupAliases, "group"),
        requireProject: async (projectId: string) => {
          const resolvedProjectId = resolveConfiguredAlias(
            projectId,
            deps.config.projectAliases,
            "project"
          );
          const project = await getProject(deps.client, resolvedProjectId);
          assertProjectAllowed(deps.config, project);
          return project;
        },
        requireGroup: async (groupId: string) => {
          const resolvedGroupId = resolveConfiguredAlias(
            groupId,
            deps.config.groupAliases,
            "group"
          );
          const group = await getGroup(deps.client, resolvedGroupId);
          assertGroupAllowed(deps.config, group);
          return group;
        }
      };

      try {
        if (definition.safety === "safe-write" || definition.safety === "destructive") {
          assertWriteEnabled(deps.config);
        }

        if (definition.safety === "destructive") {
          assertDestructiveEnabled(
            deps.config,
            extractConfirmDestructive(normalizedArgs)
          );
        }

        const data = await definition.handler(
          normalizedArgs as z.output<z.ZodObject<TSchema>>,
          context
        );

        await deps.client.audit({
          event: "tool_execution",
          tool: definition.name,
          safety: definition.safety,
          status: "ok"
        });

        return toolSuccess(data);
      } catch (error) {
        await deps.client.audit({
          event: "tool_execution",
          tool: definition.name,
          safety: definition.safety,
          status: error instanceof GuardrailError ? "blocked" : "error",
          metadata: { message: buildUserFacingError(error) }
        });

        return toolFailure(error);
      }
    }
  );
}

export function resolveConfiguredAlias(
  value: string,
  aliases: AliasMap,
  aliasType: "project" | "group"
): string {
  let current = value;
  const seen = new Set<string>();

  while (Object.prototype.hasOwnProperty.call(aliases, current)) {
    if (seen.has(current)) {
      throw new GuardrailError(
        `Detected a ${aliasType} alias cycle while resolving "${value}".`,
        "ALIAS_CYCLE_DETECTED"
      );
    }

    seen.add(current);
    const next = aliases[current];

    if (typeof next !== "string" || next.length === 0) {
      break;
    }

    current = next;
  }

  return current;
}

export function resolveToolArgumentAliases(
  args: Record<string, unknown>,
  config: AppConfig
): Record<string, unknown> {
  const normalizedArgs = { ...args };

  if (typeof normalizedArgs.project_id === "string") {
    normalizedArgs.project_id = resolveConfiguredAlias(
      normalizedArgs.project_id,
      config.projectAliases,
      "project"
    );
  }

  if (typeof normalizedArgs.group_id === "string") {
    normalizedArgs.group_id = resolveConfiguredAlias(
      normalizedArgs.group_id,
      config.groupAliases,
      "group"
    );
  }

  return normalizedArgs;
}

export async function getProject(client: GitLabClient, projectId: string): Promise<JsonMap> {
  const response = await client.getJson<JsonMap>(`/projects/${encodeURIComponent(projectId)}`);
  return response.data;
}

export async function getGroup(client: GitLabClient, groupId: string): Promise<JsonMap> {
  const response = await client.getJson<JsonMap>(`/groups/${encodeURIComponent(groupId)}`);
  return response.data;
}

export function accessLevelOf(project: JsonMap): number {
  const permissions = project.permissions as JsonMap | undefined;
  const projectAccess = permissions?.project_access as JsonMap | undefined;
  const groupAccess = permissions?.group_access as JsonMap | undefined;

  const projectLevel = typeof projectAccess?.access_level === "number" ? projectAccess.access_level : 0;
  const groupLevel = typeof groupAccess?.access_level === "number" ? groupAccess.access_level : 0;

  return Math.max(projectLevel, groupLevel);
}

export function assertMaintainerAccess(project: JsonMap): void {
  if (accessLevelOf(project) < ACCESS_LEVEL.maintainer) {
    throw new GuardrailError(
      "This operation requires Maintainer-level access or higher on the target project.",
      "INSUFFICIENT_PROJECT_ACCESS"
    );
  }
}

export function assertCommentAccess(project: JsonMap): void {
  if (accessLevelOf(project) < ACCESS_LEVEL.guest) {
    throw new GuardrailError(
      "This operation requires Guest-level access or higher on the target project.",
      "INSUFFICIENT_PROJECT_ACCESS"
    );
  }
}

export function assertDeveloperAccess(project: JsonMap): void {
  if (accessLevelOf(project) < ACCESS_LEVEL.developer) {
    throw new GuardrailError(
      "This operation requires Developer-level access or higher on the target project.",
      "INSUFFICIENT_PROJECT_ACCESS"
    );
  }
}

export function paginateResult<T>(items: readonly T[], pagination: unknown): JsonMap {
  return {
    items,
    pagination
  };
}

export function cleanQuery(
  query: Record<string, string | number | boolean | undefined | null | readonly string[]>
): Record<string, string | number | boolean | readonly string[]> {
  const result: Record<string, string | number | boolean | readonly string[]> = {};

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }

  return result;
}

function extractConfirmDestructive(args: Record<string, unknown>): boolean {
  return args.confirm_destructive === true;
}

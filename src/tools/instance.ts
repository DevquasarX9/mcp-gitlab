import { z } from "zod";

import { assertGroupAllowed, assertProjectAllowed } from "../security/guards.js";
import type { JsonMap } from "../gitlab/types.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function isAllowedProject(config: ToolDeps["config"], project: JsonMap): boolean {
  try {
    assertProjectAllowed(config, project);
    return true;
  } catch {
    return false;
  }
}

function isAllowedGroup(config: ToolDeps["config"], group: JsonMap): boolean {
  try {
    assertGroupAllowed(config, group);
    return true;
  } catch {
    return false;
  }
}

export function registerInstanceTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_get_current_user",
    title: "Get Current User",
    description: "Return the authenticated GitLab user associated with the configured token.",
    safety: "read-only",
    inputSchema: {},
    handler: async (_args, { client }) => {
      const response = await client.getJson<JsonMap>("/user");
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_validate_token",
    title: "Validate Token",
    description:
      "Validate the configured token against GitLab and return identity, version, and server configuration status.",
    safety: "read-only",
    inputSchema: {},
    handler: async (_args, { client, config }) => {
      const [userResponse, versionResponse] = await Promise.all([
        client.getJson<JsonMap>("/user"),
        client.getJson<JsonMap>("/version")
      ]);

      let patDetails: JsonMap | null = null;

      try {
        const patResponse = await client.getJson<JsonMap>("/personal_access_tokens/self");
        patDetails = patResponse.data;
      } catch {
        patDetails = null;
      }

      return {
        valid: true,
        user: userResponse.data,
        version: versionResponse.data,
        token_header_mode: config.tokenHeaderMode,
        write_tools_enabled: config.enableWriteTools,
        destructive_tools_enabled: config.enableDestructiveTools,
        dry_run_enabled: config.enableDryRun,
        personal_access_token: patDetails
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_version",
    title: "Get GitLab Version",
    description: "Return the version metadata of the connected GitLab instance.",
    safety: "read-only",
    inputSchema: {},
    handler: async (_args, { client }) => {
      const response = await client.getJson<JsonMap>("/version");
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_accessible_projects",
    title: "List Accessible Projects",
    description:
      "List projects accessible to the configured token, filtered by configured allowlists and deny lists.",
    safety: "read-only",
    inputSchema: {
      membership: z.boolean().optional().default(true),
      search: z.string().trim().optional(),
      archived: z.boolean().optional(),
      min_access_level: z.number().int().min(0).max(50).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, config }) => {
      const response = await client.getJson<JsonMap[]>("/projects", {
        query: cleanQuery({
          membership: args.membership,
          search: args.search,
          archived: args.archived,
          min_access_level: args.min_access_level,
          page: args.page,
          per_page: args.per_page,
          simple: true
        })
      });

      return {
        items: response.data.filter((project) => isAllowedProject(config, project)),
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_list_accessible_groups",
    title: "List Accessible Groups",
    description:
      "List groups accessible to the configured token, filtered by the configured group allowlist when present.",
    safety: "read-only",
    inputSchema: {
      search: z.string().trim().optional(),
      min_access_level: z.number().int().min(0).max(50).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, config }) => {
      const response = await client.getJson<JsonMap[]>("/groups", {
        query: cleanQuery({
          search: args.search,
          min_access_level: args.min_access_level,
          page: args.page,
          per_page: args.per_page,
          all_available: false
        })
      });

      return {
        items: response.data.filter((group) => isAllowedGroup(config, group)),
        pagination: response.pagination
      };
    }
  });
}

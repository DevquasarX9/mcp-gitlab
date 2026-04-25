import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { assertProjectAllowed } from "../security/guards.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function isAllowedProject(config: ToolDeps["config"], project: JsonMap): boolean {
  try {
    assertProjectAllowed(config, project);
    return true;
  } catch {
    return false;
  }
}

export function registerProjectTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_search_projects",
    title: "Search Projects",
    description: "Search GitLab projects by name or path.",
    safety: "read-only",
    inputSchema: {
      search: z.string().trim().min(1),
      archived: z.boolean().optional(),
      membership: z.boolean().optional(),
      simple: z.boolean().optional().default(true),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, config }) => {
      const response = await client.getJson<JsonMap[]>("/projects", {
        query: cleanQuery({
          search: args.search,
          archived: args.archived,
          membership: args.membership,
          simple: args.simple,
          page: args.page,
          per_page: args.per_page
        })
      });

      return {
        items: response.data.filter((project) => isAllowedProject(config, project)),
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project",
    title: "Get Project",
    description: "Retrieve detailed metadata for a single GitLab project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1)
    },
    handler: async (args, { requireProject }) => {
      return requireProject(args.project_id);
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project_members",
    title: "Get Project Members",
    description: "List effective project members, including inherited group memberships.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      query: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/members/all`,
        {
          query: cleanQuery({
            query: args.query,
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project_languages",
    title: "Get Project Languages",
    description: "Return the language breakdown for a project repository.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/languages`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project_activity",
    title: "Get Project Activity",
    description: "Return recent visible project events and activity.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      action: z.string().trim().optional(),
      target_type: z.string().trim().optional(),
      after: z.string().trim().optional(),
      before: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/events`,
        {
          query: cleanQuery({
            action: args.action,
            target_type: args.target_type,
            after: args.after,
            before: args.before,
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_project_statistics",
    title: "Get Project Statistics",
    description: "Return repository and storage statistics for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/statistics`
      );
      return response.data;
    }
  });
}

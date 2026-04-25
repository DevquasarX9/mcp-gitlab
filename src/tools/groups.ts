import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { assertGroupAllowed } from "../security/guards.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

async function requireAllowedGroup(
  groupId: string,
  deps: { client: ToolDeps["client"]; config: ToolDeps["config"] }
): Promise<JsonMap> {
  const response = await deps.client.getJson<JsonMap>(`/groups/${encodeURIComponent(groupId)}`);
  assertGroupAllowed(deps.config, response.data);
  return response.data;
}

function isAllowedGroup(config: ToolDeps["config"], group: JsonMap): boolean {
  try {
    assertGroupAllowed(config, group);
    return true;
  } catch {
    return false;
  }
}

export function registerGroupTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_search_groups",
    title: "Search Groups",
    description: "Search GitLab groups by name or path.",
    safety: "read-only",
    inputSchema: {
      search: z.string().trim().min(1),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, config }) => {
      const response = await client.getJson<JsonMap[]>("/groups", {
        query: cleanQuery({
          search: args.search,
          page: args.page,
          per_page: args.per_page
        })
      });

      return {
        items: response.data.filter((group) => isAllowedGroup(config, group)),
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_group",
    title: "Get Group",
    description: "Retrieve a single GitLab group by ID or full path.",
    safety: "read-only",
    inputSchema: {
      group_id: z.string().trim().min(1)
    },
    handler: async (args) => {
      return requireAllowedGroup(args.group_id, deps);
    }
  });

  registerTool(deps, {
    name: "gitlab_list_group_projects",
    title: "List Group Projects",
    description: "List projects within a group.",
    safety: "read-only",
    inputSchema: {
      group_id: z.string().trim().min(1),
      include_subgroups: z.boolean().optional(),
      search: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client }) => {
      await requireAllowedGroup(args.group_id, deps);
      const response = await client.getJson<JsonMap[]>(
        `/groups/${encodeURIComponent(args.group_id)}/projects`,
        {
          query: cleanQuery({
            include_subgroups: args.include_subgroups,
            search: args.search,
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
    name: "gitlab_list_group_members",
    title: "List Group Members",
    description: "List effective group members, including inherited members.",
    safety: "read-only",
    inputSchema: {
      group_id: z.string().trim().min(1),
      query: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client }) => {
      await requireAllowedGroup(args.group_id, deps);
      const response = await client.getJson<JsonMap[]>(
        `/groups/${encodeURIComponent(args.group_id)}/members/all`,
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
    name: "gitlab_list_group_issues",
    title: "List Group Issues",
    description: "List issues for a group and its descendant projects.",
    safety: "read-only",
    inputSchema: {
      group_id: z.string().trim().min(1),
      state: z.enum(["opened", "closed", "all"]).optional(),
      search: z.string().trim().optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client }) => {
      await requireAllowedGroup(args.group_id, deps);
      const response = await client.getJson<JsonMap[]>(
        `/groups/${encodeURIComponent(args.group_id)}/issues`,
        {
          query: cleanQuery({
            state: args.state,
            search: args.search,
            labels: args.labels?.join(","),
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
    name: "gitlab_list_group_merge_requests",
    title: "List Group Merge Requests",
    description: "List merge requests for a group and its descendant projects.",
    safety: "read-only",
    inputSchema: {
      group_id: z.string().trim().min(1),
      state: z.enum(["opened", "closed", "merged", "locked", "all"]).optional(),
      search: z.string().trim().optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client }) => {
      await requireAllowedGroup(args.group_id, deps);
      const response = await client.getJson<JsonMap[]>(
        `/groups/${encodeURIComponent(args.group_id)}/merge_requests`,
        {
          query: cleanQuery({
            state: args.state,
            search: args.search,
            labels: args.labels?.join(","),
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
}

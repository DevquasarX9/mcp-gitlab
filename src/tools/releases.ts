import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { assertDeveloperAccess, cleanQuery, registerTool, type ToolDeps } from "./shared.js";

export function registerReleaseTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_releases",
    title: "List Releases",
    description: "List releases for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/releases`,
        {
          query: cleanQuery({
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
    name: "gitlab_get_release",
    title: "Get Release",
    description: "Retrieve a single project release by tag name.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      tag_name: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/releases/${encodeURIComponent(args.tag_name)}`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_create_release",
    title: "Create Release",
    description: "Create a new project release.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      name: z.string().trim().min(1),
      tag_name: z.string().trim().min(1),
      description: z.string().optional(),
      ref: z.string().trim().optional(),
      milestones: z.array(z.string().trim().min(1)).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        name: args.name,
        tag_name: args.tag_name,
        description: args.description,
        ref: args.ref,
        milestones: args.milestones
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/releases`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/releases`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_list_packages",
    title: "List Packages",
    description: "List project packages.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      package_type: z.string().trim().optional(),
      package_name: z.string().trim().optional(),
      package_version: z.string().trim().optional(),
      include_versionless: z.boolean().optional(),
      status: z.string().trim().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/packages`,
        {
          query: cleanQuery({
            package_type: args.package_type,
            package_name: args.package_name,
            package_version: args.package_version,
            include_versionless: args.include_versionless,
            status: args.status,
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
    name: "gitlab_get_package",
    title: "Get Package",
    description: "Retrieve a single package from a project package registry.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      package_id: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/packages/${args.package_id}`
      );
      return response.data;
    }
  });
}

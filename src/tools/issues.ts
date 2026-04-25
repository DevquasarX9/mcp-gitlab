import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { assertDeveloperAccess } from "./shared.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function labelsToCsv(labels?: readonly string[]): string | undefined {
  if (!labels || labels.length === 0) {
    return undefined;
  }

  return labels.join(",");
}

export function registerIssueTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_issues",
    title: "List Issues",
    description: "List issues for a GitLab project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      state: z.enum(["opened", "closed", "all"]).optional(),
      search: z.string().trim().optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      assignee_id: z.union([z.number().int().positive(), z.enum(["None", "Any"])]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/issues`,
        {
          query: cleanQuery({
            state: args.state,
            search: args.search,
            labels: labelsToCsv(args.labels),
            assignee_id: args.assignee_id,
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
    name: "gitlab_get_issue",
    title: "Get Issue",
    description: "Retrieve a single issue by IID from a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      issue_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/issues/${args.issue_iid}`
      );
      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_search_issues",
    title: "Search Issues",
    description: "Search issues in a project using title and description matching.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      search: z.string().trim().min(1),
      in: z.enum(["title", "description", "title,description"]).optional(),
      state: z.enum(["opened", "closed", "all"]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/issues`,
        {
          query: cleanQuery({
            search: args.search,
            in: args.in,
            state: args.state,
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
    name: "gitlab_create_issue",
    title: "Create Issue",
    description: "Create a new GitLab issue in a project.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      title: z.string().trim().min(1),
      description: z.string().optional(),
      assignee_ids: z.array(z.number().int().positive()).optional(),
      milestone_id: z.number().int().positive().optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      confidential: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        title: args.title,
        description: args.description,
        assignee_ids: args.assignee_ids,
        milestone_id: args.milestone_id,
        labels: labelsToCsv(args.labels),
        confidential: args.confidential
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/issues`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/issues`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_update_issue",
    title: "Update Issue",
    description: "Update a GitLab issue in a project.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      issue_iid: z.number().int().positive(),
      title: z.string().trim().optional(),
      description: z.string().optional(),
      assignee_ids: z.array(z.number().int().positive()).optional(),
      milestone_id: z.number().int().positive().optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      confidential: z.boolean().optional(),
      state_event: z.enum(["close", "reopen"]).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        title: args.title,
        description: args.description,
        assignee_ids: args.assignee_ids,
        milestone_id: args.milestone_id,
        labels: args.labels ? labelsToCsv(args.labels) : undefined,
        confidential: args.confidential,
        state_event: args.state_event
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/issues/${args.issue_iid}`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/issues/${args.issue_iid}`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_add_issue_comment",
    title: "Add Issue Comment",
    description: "Add a note or comment to a GitLab issue.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      issue_iid: z.number().int().positive(),
      body: z.string().trim().min(1),
      internal: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        body: args.body,
        internal: args.internal
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/issues/${args.issue_iid}/notes`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/issues/${args.issue_iid}/notes`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_close_issue",
    title: "Close Issue",
    description: "Close an issue by setting state_event=close.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      issue_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = { state_event: "close" };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/issues/${args.issue_iid}`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/issues/${args.issue_iid}`,
        { body }
      );

      return response.data;
    }
  });
}

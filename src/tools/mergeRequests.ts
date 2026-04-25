import { Buffer } from "node:buffer";

import { z } from "zod";

import type { JsonMap } from "../gitlab/types.js";
import { assertMaxSize } from "../security/guards.js";
import { assertDeveloperAccess, cleanQuery, registerTool, type ToolDeps } from "./shared.js";

function labelsToCsv(labels?: readonly string[]): string | undefined {
  if (!labels || labels.length === 0) {
    return undefined;
  }

  return labels.join(",");
}

function totalDiffBytes(items: readonly JsonMap[]): number {
  return items.reduce((sum, item) => {
    const diff = typeof item.diff === "string" ? item.diff : "";
    return sum + Buffer.byteLength(diff, "utf8");
  }, 0);
}

export function registerMergeRequestTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_list_merge_requests",
    title: "List Merge Requests",
    description: "List merge requests in a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      state: z.enum(["opened", "closed", "locked", "merged", "all"]).optional(),
      search: z.string().trim().optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      reviewer_id: z.union([z.number().int().positive(), z.enum(["None", "Any"])]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: cleanQuery({
            state: args.state,
            search: args.search,
            labels: labelsToCsv(args.labels),
            reviewer_id: args.reviewer_id,
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
    name: "gitlab_get_merge_request",
    title: "Get Merge Request",
    description: "Retrieve a single merge request by IID.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}`,
        {
          query: {
            include_diverged_commits_count: true,
            include_rebase_in_progress: true
          }
        }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_get_merge_request_changes",
    title: "Get Merge Request Changes",
    description:
      "Retrieve merge request change metadata and changed files. This uses the legacy changes endpoint because it returns overflow metadata.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      access_raw_diffs: z.boolean().optional(),
      unidiff: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/changes`,
        {
          query: cleanQuery({
            access_raw_diffs: args.access_raw_diffs,
            unidiff: args.unidiff
          })
        }
      );

      const changes = Array.isArray(response.data.changes)
        ? (response.data.changes as JsonMap[])
        : [];
      assertMaxSize(totalDiffBytes(changes), config.maxDiffSizeBytes, "Merge request change payload");

      return {
        ...response.data,
        changes,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_merge_request_diff",
    title: "Get Merge Request Diff",
    description: "List the file diffs for a merge request.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().max(100).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/diffs`,
        {
          query: cleanQuery({
            page: args.page,
            per_page: args.per_page
          })
        }
      );

      assertMaxSize(totalDiffBytes(response.data), config.maxDiffSizeBytes, "Merge request diff payload");

      return {
        items: response.data,
        pagination: response.pagination,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_get_merge_request_discussions",
    title: "Get Merge Request Discussions",
    description: "List all discussions for a merge request.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions`
      );

      return {
        items: response.data,
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_create_merge_request",
    title: "Create Merge Request",
    description: "Create a merge request in a project.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      title: z.string().trim().min(1),
      source_branch: z.string().trim().min(1),
      target_branch: z.string().trim().min(1),
      target_project_id: z.number().int().positive().optional(),
      description: z.string().optional(),
      assignee_ids: z.array(z.number().int().positive()).optional(),
      reviewer_ids: z.array(z.number().int().positive()).optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      milestone_id: z.number().int().positive().optional(),
      remove_source_branch: z.boolean().optional(),
      squash: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        title: args.title,
        source_branch: args.source_branch,
        target_branch: args.target_branch,
        target_project_id: args.target_project_id,
        description: args.description,
        assignee_ids: args.assignee_ids,
        reviewer_ids: args.reviewer_ids,
        labels: labelsToCsv(args.labels),
        milestone_id: args.milestone_id,
        remove_source_branch: args.remove_source_branch,
        squash: args.squash
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_update_merge_request",
    title: "Update Merge Request",
    description: "Update metadata for a merge request.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      title: z.string().trim().optional(),
      description: z.string().optional(),
      target_branch: z.string().trim().optional(),
      assignee_ids: z.array(z.number().int().positive()).optional(),
      reviewer_ids: z.array(z.number().int().positive()).optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
      milestone_id: z.number().int().positive().optional(),
      state_event: z.enum(["close", "reopen"]).optional(),
      remove_source_branch: z.boolean().optional(),
      squash: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        title: args.title,
        description: args.description,
        target_branch: args.target_branch,
        assignee_ids: args.assignee_ids,
        reviewer_ids: args.reviewer_ids,
        labels: args.labels ? labelsToCsv(args.labels) : undefined,
        milestone_id: args.milestone_id,
        state_event: args.state_event,
        remove_source_branch: args.remove_source_branch,
        squash: args.squash
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_add_merge_request_comment",
    title: "Add Merge Request Comment",
    description: "Add a top-level note to a merge request.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
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
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/notes`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/notes`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_approve_merge_request",
    title: "Approve Merge Request",
    description: "Approve a merge request as the current user.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      sha: z.string().trim().optional(),
      approval_password: z.string().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        sha: args.sha,
        approval_password: args.approval_password
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/approve`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/approve`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_merge_merge_request",
    title: "Merge Merge Request",
    description:
      "Merge a merge request. This is treated as destructive and requires confirm_destructive=true.",
    safety: "destructive",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      merge_commit_message: z.string().optional(),
      should_remove_source_branch: z.boolean().optional(),
      squash: z.boolean().optional(),
      sha: z.string().trim().optional(),
      auto_merge: z.boolean().optional(),
      confirm_destructive: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        merge_commit_message: args.merge_commit_message,
        should_remove_source_branch: args.should_remove_source_branch,
        squash: args.squash,
        sha: args.sha,
        auto_merge: args.auto_merge
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/merge`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/merge`,
        { body }
      );

      return response.data;
    }
  });
}

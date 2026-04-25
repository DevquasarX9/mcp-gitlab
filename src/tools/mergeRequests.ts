import { Buffer } from "node:buffer";

import { z } from "zod";

import { GuardrailError } from "../gitlab/errors.js";
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

function toReviewerIds(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (item && typeof item === "object") {
        const id = Reflect.get(item, "id");
        return typeof id === "number" ? id : null;
      }

      return null;
    })
    .filter((item): item is number => item !== null);
}

async function getMergeRequestVersion(
  client: ToolDeps["client"],
  projectId: string,
  mergeRequestIid: number
): Promise<JsonMap> {
  const response = await client.getJson<JsonMap[]>(
    `/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestIid}/versions`,
    {
      query: {
        per_page: 1
      }
    }
  );

  const latestVersion = response.data[0];
  if (!latestVersion) {
    throw new GuardrailError(
      "GitLab did not return a merge request diff version. Try again after the merge request finishes preparing.",
      "MISSING_MERGE_REQUEST_VERSION"
    );
  }

  return latestVersion;
}

function buildDiscussionPosition(
  version: JsonMap,
  args: {
    new_path?: string;
    old_path?: string;
    line_number?: number;
    line_type?: "new" | "old";
  }
): JsonMap {
  if (!args.new_path || !args.line_number || !args.line_type) {
    throw new GuardrailError(
      "Diff discussions require new_path, line_number, and line_type.",
      "INVALID_DIFF_DISCUSSION_POSITION"
    );
  }

  const baseSha = typeof version.base_commit_sha === "string" ? version.base_commit_sha : null;
  const headSha = typeof version.head_commit_sha === "string" ? version.head_commit_sha : null;
  const startSha = typeof version.start_commit_sha === "string" ? version.start_commit_sha : null;

  if (!baseSha || !headSha || !startSha) {
    throw new GuardrailError(
      "GitLab did not provide diff refs for the merge request version.",
      "MISSING_DIFF_REFS"
    );
  }

  return {
    position_type: "text",
    base_sha: baseSha,
    head_sha: headSha,
    start_sha: startSha,
    old_path: args.old_path ?? args.new_path,
    new_path: args.new_path,
    ...(args.line_type === "new"
      ? { new_line: args.line_number }
      : { old_line: args.line_number })
  };
}

export function findResolvableDiscussionNoteId(discussion: JsonMap): number | null {
  const notes = Array.isArray(discussion.notes) ? (discussion.notes as JsonMap[]) : [];

  for (const note of [...notes].reverse()) {
    if (note.resolvable === true && typeof note.id === "number") {
      return note.id;
    }
  }

  return null;
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
    name: "gitlab_create_merge_request_thread",
    title: "Create Merge Request Thread",
    description:
      "Create an overview thread or a diff-position thread on a merge request.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      body: z.string().trim().min(1),
      discussion_type: z.enum(["overview", "diff"]).optional().default("overview"),
      new_path: z.string().trim().optional(),
      old_path: z.string().trim().optional(),
      line_number: z.number().int().positive().optional(),
      line_type: z.enum(["new", "old"]).optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      let body: JsonMap = {
        body: args.body
      };

      if (args.discussion_type === "diff") {
        const version = await getMergeRequestVersion(client, args.project_id, args.merge_request_iid);
        body = {
          ...body,
          position: buildDiscussionPosition(version, args)
        };
      }

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/discussions`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_reply_to_discussion",
    title: "Reply To Discussion",
    description: "Reply to an existing merge request discussion thread.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      discussion_id: z.string().trim().min(1),
      body: z.string().trim().min(1)
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const body = {
        body: args.body
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/discussions/${args.discussion_id}/notes`,
          body
        };
      }

      const response = await client.postJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions/${encodeURIComponent(args.discussion_id)}/notes`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_resolve_discussion",
    title: "Resolve Discussion",
    description:
      "Resolve a merge request discussion by updating a resolvable discussion note.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      discussion_id: z.string().trim().min(1),
      note_id: z.number().int().positive().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      let noteId = args.note_id ?? null;

      if (noteId === null) {
        const discussionResponse = await client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions/${encodeURIComponent(args.discussion_id)}`
        );
        noteId = findResolvableDiscussionNoteId(discussionResponse.data);
      }

      if (noteId === null) {
        throw new GuardrailError(
          "No resolvable note was found for this discussion. Provide note_id explicitly if needed.",
          "NO_RESOLVABLE_DISCUSSION_NOTE"
        );
      }

      const body = {
        resolved: true
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/discussions/${args.discussion_id}/notes/${noteId}`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions/${encodeURIComponent(args.discussion_id)}/notes/${noteId}`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_unresolve_discussion",
    title: "Unresolve Discussion",
    description:
      "Reopen a previously resolved merge request discussion by updating a resolvable note.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      discussion_id: z.string().trim().min(1),
      note_id: z.number().int().positive().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      let noteId = args.note_id ?? null;

      if (noteId === null) {
        const discussionResponse = await client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions/${encodeURIComponent(args.discussion_id)}`
        );
        noteId = findResolvableDiscussionNoteId(discussionResponse.data);
      }

      if (noteId === null) {
        throw new GuardrailError(
          "No resolvable note was found for this discussion. Provide note_id explicitly if needed.",
          "NO_RESOLVABLE_DISCUSSION_NOTE"
        );
      }

      const body = {
        resolved: false
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/discussions/${args.discussion_id}/notes/${noteId}`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions/${encodeURIComponent(args.discussion_id)}/notes/${noteId}`,
        { body }
      );

      return response.data;
    }
  });

  registerTool(deps, {
    name: "gitlab_request_merge_request_review",
    title: "Request Merge Request Review",
    description:
      "Assign reviewers to a merge request, optionally preserving existing reviewer assignments.",
    safety: "safe-write",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      reviewer_ids: z.array(z.number().int().positive()).min(1),
      replace_existing_reviewers: z.boolean().optional().default(false)
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const mergeRequestResponse = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}`
      );

      const existingReviewerIds = args.replace_existing_reviewers
        ? []
        : toReviewerIds(mergeRequestResponse.data.reviewers);

      const reviewerIds = Array.from(new Set([...existingReviewerIds, ...args.reviewer_ids]));
      const body = {
        reviewer_ids: reviewerIds
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
    name: "gitlab_rebase_merge_request",
    title: "Rebase Merge Request",
    description:
      "Queue a rebase of the merge request source branch onto the target branch. This rewrites branch history and requires confirm_destructive=true.",
    safety: "destructive",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      skip_ci: z.boolean().optional(),
      confirm_destructive: z.boolean().optional()
    },
    handler: async (args, { client, requireProject, config }) => {
      const project = await requireProject(args.project_id);
      assertDeveloperAccess(project);

      const mergeRequestResponse = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}`,
        {
          query: {
            include_rebase_in_progress: true
          }
        }
      );

      if (mergeRequestResponse.data.state !== "opened") {
        throw new GuardrailError(
          "Only opened merge requests can be rebased.",
          "INVALID_MERGE_REQUEST_STATE"
        );
      }

      if (mergeRequestResponse.data.rebase_in_progress === true) {
        throw new GuardrailError(
          "A rebase is already in progress for this merge request.",
          "REBASE_ALREADY_IN_PROGRESS"
        );
      }

      const body = {
        skip_ci: args.skip_ci
      };

      if (config.enableDryRun) {
        return {
          dry_run: true,
          endpoint: `/projects/${args.project_id}/merge_requests/${args.merge_request_iid}/rebase`,
          body
        };
      }

      const response = await client.putJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/rebase`,
        { body }
      );

      return {
        enqueued: true,
        merge_request: mergeRequestResponse.data,
        response: response.data
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

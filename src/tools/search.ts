import { z } from "zod";

import { GuardrailError } from "../gitlab/errors.js";
import type { JsonMap } from "../gitlab/types.js";
import { cleanQuery, paginateResult, registerTool, type ToolDeps, type ToolExecutionContext } from "./shared.js";

const searchScopeSchema = z.enum([
  "projects",
  "issues",
  "work_items",
  "merge_requests",
  "milestones",
  "snippet_titles",
  "users",
  "wiki_blobs",
  "commits",
  "blobs",
  "notes"
]);

const searchTypeSchema = z.enum(["basic", "advanced", "zoekt"]).optional();
const stateSchema = z.enum(["opened", "closed", "all"]).optional();
const sortSchema = z.enum(["asc", "desc"]).optional();
const orderBySchema = z.enum(["created_at"]).optional();
const workItemTypeSchema = z.enum([
  "issue",
  "task",
  "epic",
  "incident",
  "test_case",
  "requirement",
  "objective",
  "key_result",
  "ticket"
]);

const gitlabSearchInputSchema = {
  scope: searchScopeSchema,
  search: z.string().min(1),
  project_id: z.string().min(1).optional(),
  group_id: z.string().min(1).optional(),
  search_type: searchTypeSchema,
  state: stateSchema,
  confidential: z.boolean().optional(),
  fields: z.array(z.enum(["title"])).optional(),
  type: z.array(workItemTypeSchema).optional(),
  order_by: orderBySchema,
  sort: sortSchema,
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().max(100).optional()
};

const gitlabSearchLabelsInputSchema = {
  full_path: z.string().min(1),
  is_project: z.boolean(),
  search: z.string().min(1).optional(),
  with_counts: z.boolean().optional(),
  include_ancestor_groups: z.boolean().optional(),
  archived: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().max(100).optional()
};

type GitLabSearchArgs = z.output<z.ZodObject<typeof gitlabSearchInputSchema>>;
type GitLabSearchLabelsArgs = z.output<z.ZodObject<typeof gitlabSearchLabelsInputSchema>>;
type GitLabSearchContext = Pick<
  ToolExecutionContext,
  "resolveProjectId" | "resolveGroupId" | "requireProject" | "requireGroup"
> & {
  readonly config: Pick<ToolExecutionContext["config"], "projectAllowlist" | "groupAllowlist" | "projectDenylist">;
};

export interface GitLabSearchRequest {
  readonly path: string;
  readonly query: Record<string, string | number | boolean | readonly string[]>;
  readonly target: "global" | "project" | "group";
}

export async function buildGitLabSearchRequest(
  args: GitLabSearchArgs,
  context: GitLabSearchContext
): Promise<GitLabSearchRequest> {
  if (args.project_id && args.group_id) {
    throw new GuardrailError(
      "gitlab_search accepts either project_id or group_id, not both.",
      "INVALID_SEARCH_TARGET"
    );
  }

  if (
    !args.project_id &&
    !args.group_id &&
    (
      context.config.projectAllowlist.length > 0 ||
      context.config.groupAllowlist.length > 0 ||
      context.config.projectDenylist.length > 0
    )
  ) {
    throw new GuardrailError(
      "Global gitlab_search is disabled when project or group scope controls are configured. Provide project_id or group_id so allowlists and denylists can be enforced.",
      "GLOBAL_SEARCH_REQUIRES_SCOPED_TARGET"
    );
  }

  const query = cleanQuery({
    scope: args.scope,
    search: args.search,
    search_type: args.search_type,
    state: args.state,
    confidential: args.confidential,
    fields: args.fields,
    type: args.type,
    order_by: args.order_by,
    sort: args.sort,
    page: args.page,
    per_page: args.per_page
  });

  if (args.project_id) {
    const projectId = context.resolveProjectId(args.project_id);
    await context.requireProject(args.project_id);

    return {
      path: `/projects/${encodeURIComponent(projectId)}/search`,
      query,
      target: "project"
    };
  }

  if (args.group_id) {
    const groupId = context.resolveGroupId(args.group_id);
    await context.requireGroup(args.group_id);

    return {
      path: `/groups/${encodeURIComponent(groupId)}/search`,
      query,
      target: "group"
    };
  }

  return {
    path: "/search",
    query,
    target: "global"
  };
}

export async function buildGitLabSearchLabelsRequest(
  args: GitLabSearchLabelsArgs,
  context: Pick<ToolExecutionContext, "resolveProjectId" | "resolveGroupId" | "requireProject" | "requireGroup">
): Promise<GitLabSearchRequest> {
  const query = cleanQuery({
    search: args.search,
    with_counts: args.with_counts,
    include_ancestor_groups: args.include_ancestor_groups,
    archived: args.archived,
    page: args.page,
    per_page: args.per_page
  });

  if (args.is_project) {
    const projectId = context.resolveProjectId(args.full_path);
    await context.requireProject(args.full_path);

    return {
      path: `/projects/${encodeURIComponent(projectId)}/labels`,
      query,
      target: "project"
    };
  }

  const groupId = context.resolveGroupId(args.full_path);
  await context.requireGroup(args.full_path);

  return {
    path: `/groups/${encodeURIComponent(groupId)}/labels`,
    query,
    target: "group"
  };
}

export function registerSearchTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_search",
    title: "Search GitLab",
    description:
      "Search across GitLab globally or within one allowed project or group. Provide either project_id, group_id, or neither for global search; global search is disabled when project/group scope controls are configured.",
    safety: "read-only",
    category: "projects",
    inputSchema: gitlabSearchInputSchema,
    handler: async (args, context) => {
      const request = await buildGitLabSearchRequest(args, context);
      const response = await context.client.getJson<readonly JsonMap[]>(request.path, {
        query: request.query
      });

      return {
        target: request.target,
        scope: args.scope,
        ...paginateResult(response.data, response.pagination),
        content_is_untrusted: true
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_search_labels",
    title: "Search GitLab Labels",
    description:
      "Search project or group labels, optionally including issue and merge request counts when GitLab exposes them.",
    safety: "read-only",
    category: "projects",
    inputSchema: gitlabSearchLabelsInputSchema,
    handler: async (args, context) => {
      const request = await buildGitLabSearchLabelsRequest(args, context);
      const response = await context.client.getJson<readonly JsonMap[]>(request.path, {
        query: request.query
      });

      return {
        target: request.target,
        ...paginateResult(response.data, response.pagination),
        content_is_untrusted: true
      };
    }
  });
}

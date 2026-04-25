import { z } from "zod";

import { GitLabGraphQLClient } from "../gitlab/graphqlClient.js";
import type { JsonMap } from "../gitlab/types.js";
import { registerTool, type ToolDeps } from "./shared.js";

interface GraphQLConnection<TNode> {
  readonly nodes?: readonly TNode[] | null;
}

interface GraphQLUser {
  readonly username?: string | null;
  readonly name?: string | null;
  readonly webUrl?: string | null;
}

interface GraphQLDiscussion {
  readonly id?: string | null;
  readonly resolved?: boolean | null;
  readonly resolvable?: boolean | null;
  readonly resolvedAt?: string | null;
  readonly resolvedBy?: GraphQLUser | null;
}

interface GraphQLPipelineDetailedStatus {
  readonly text?: string | null;
  readonly label?: string | null;
  readonly group?: string | null;
  readonly icon?: string | null;
}

interface GraphQLPipeline {
  readonly id?: string | null;
  readonly iid?: string | null;
  readonly path?: string | null;
  readonly status?: string | null;
  readonly failedJobsCount?: number | null;
  readonly ref?: string | null;
  readonly sha?: string | null;
  readonly updatedAt?: string | null;
  readonly detailedStatus?: GraphQLPipelineDetailedStatus | null;
}

interface GraphQLDiffStatsSummary {
  readonly additions?: number | null;
  readonly deletions?: number | null;
  readonly changes?: number | null;
  readonly fileCount?: number | null;
}

interface GraphQLLabel {
  readonly title?: string | null;
}

interface GraphQLMergeRequest {
  readonly iid?: string | null;
  readonly title?: string | null;
  readonly state?: string | null;
  readonly draft?: boolean | null;
  readonly webUrl?: string | null;
  readonly updatedAt?: string | null;
  readonly sourceBranch?: string | null;
  readonly targetBranch?: string | null;
  readonly mergeable?: boolean | null;
  readonly mergeableDiscussionsState?: boolean | null;
  readonly detailedMergeStatus?: string | null;
  readonly approvalsRequired?: number | null;
  readonly approvalsLeft?: number | null;
  readonly approved?: boolean | null;
  readonly resolvableDiscussionsCount?: number | null;
  readonly resolvedDiscussionsCount?: number | null;
  readonly labels?: GraphQLConnection<GraphQLLabel> | null;
  readonly reviewers?: GraphQLConnection<GraphQLUser> | null;
  readonly approvedBy?: GraphQLConnection<GraphQLUser> | null;
  readonly diffStatsSummary?: GraphQLDiffStatsSummary | null;
  readonly headPipeline?: GraphQLPipeline | null;
  readonly discussions?: GraphQLConnection<GraphQLDiscussion> | null;
}

interface ReviewStateQueryResult {
  readonly project?: {
    readonly fullPath?: string | null;
    readonly webUrl?: string | null;
    readonly mergeRequest?: GraphQLMergeRequest | null;
  } | null;
}

const MERGE_REQUEST_REVIEW_STATE_QUERY = `
  query GetMergeRequestReviewState(
    $projectPath: ID!
    $mergeRequestIid: String!
    $reviewerLimit: Int!
    $discussionLimit: Int!
    $labelLimit: Int!
  ) {
    project(fullPath: $projectPath) {
      fullPath
      webUrl
      mergeRequest(iid: $mergeRequestIid) {
        iid
        title
        state
        draft
        webUrl
        updatedAt
        sourceBranch
        targetBranch
        mergeable
        mergeableDiscussionsState
        detailedMergeStatus
        approvalsRequired
        approvalsLeft
        approved
        resolvableDiscussionsCount
        resolvedDiscussionsCount
        labels(first: $labelLimit) {
          nodes {
            title
          }
        }
        reviewers(first: $reviewerLimit) {
          nodes {
            username
            name
            webUrl
          }
        }
        approvedBy(first: $reviewerLimit) {
          nodes {
            username
            name
            webUrl
          }
        }
        diffStatsSummary {
          additions
          deletions
          changes
          fileCount
        }
        headPipeline {
          id
          iid
          path
          status
          failedJobsCount
          ref
          sha
          updatedAt
          detailedStatus {
            text
            label
            group
            icon
          }
        }
        discussions(first: $discussionLimit) {
          nodes {
            id
            resolved
            resolvable
            resolvedAt
            resolvedBy {
              username
              name
              webUrl
            }
          }
        }
      }
    }
  }
`;

const runningPipelineStatuses = new Set([
  "created",
  "pending",
  "preparing",
  "running",
  "scheduled",
  "waiting_for_resource"
]);

function takeNodes<TNode>(connection?: GraphQLConnection<TNode> | null): readonly TNode[] {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

function toUserSummary(user: GraphQLUser): JsonMap {
  return {
    username: user.username ?? null,
    name: user.name ?? null,
    web_url: user.webUrl ?? null
  };
}

function unresolvedDiscussionCount(mergeRequest: GraphQLMergeRequest): number {
  const resolvableCount = typeof mergeRequest.resolvableDiscussionsCount === "number"
    ? mergeRequest.resolvableDiscussionsCount
    : 0;
  const resolvedCount = typeof mergeRequest.resolvedDiscussionsCount === "number"
    ? mergeRequest.resolvedDiscussionsCount
    : 0;
  const sampledUnresolved = takeNodes(mergeRequest.discussions)
    .filter((discussion) => discussion.resolvable === true && discussion.resolved !== true)
    .length;

  return Math.max(sampledUnresolved, resolvableCount - resolvedCount, 0);
}

function summarizeBlockers(
  mergeRequest: GraphQLMergeRequest,
  unresolvedCount: number
): readonly string[] {
  const blockers: string[] = [];
  const state = typeof mergeRequest.state === "string" ? mergeRequest.state : "unknown";
  const approvalsLeft = typeof mergeRequest.approvalsLeft === "number" ? mergeRequest.approvalsLeft : 0;
  const mergeStatus = typeof mergeRequest.detailedMergeStatus === "string"
    ? mergeRequest.detailedMergeStatus
    : "unknown";
  const pipelineStatus = typeof mergeRequest.headPipeline?.status === "string"
    ? mergeRequest.headPipeline.status
    : null;

  if (state !== "opened") {
    blockers.push(`Merge request state is ${state}.`);
    return blockers;
  }

  if (mergeRequest.draft === true) {
    blockers.push("Merge request is still marked as draft.");
  }

  if (approvalsLeft > 0) {
    blockers.push(`${approvalsLeft} required approval(s) are still missing.`);
  }

  if (pipelineStatus === "failed") {
    blockers.push("Head pipeline is failing.");
  } else if (pipelineStatus && runningPipelineStatuses.has(pipelineStatus)) {
    blockers.push(`Head pipeline is still ${pipelineStatus}.`);
  }

  if (unresolvedCount > 0 && mergeRequest.mergeableDiscussionsState === false) {
    blockers.push(`${unresolvedCount} resolvable discussion(s) remain unresolved.`);
  }

  if (mergeRequest.mergeable === false && mergeStatus !== "MERGEABLE") {
    blockers.push(`GitLab merge status is ${mergeStatus}.`);
  }

  return blockers;
}

function determineReviewStatus(
  mergeRequest: GraphQLMergeRequest,
  unresolvedCount: number
): string {
  const state = typeof mergeRequest.state === "string" ? mergeRequest.state : "unknown";
  const approvalsLeft = typeof mergeRequest.approvalsLeft === "number" ? mergeRequest.approvalsLeft : 0;
  const pipelineStatus = typeof mergeRequest.headPipeline?.status === "string"
    ? mergeRequest.headPipeline.status
    : null;

  if (state !== "opened") {
    return "not_open";
  }

  if (mergeRequest.draft === true) {
    return "draft";
  }

  if (approvalsLeft > 0) {
    return "awaiting_approvals";
  }

  if (pipelineStatus === "failed") {
    return "pipeline_failed";
  }

  if (unresolvedCount > 0 && mergeRequest.mergeableDiscussionsState === false) {
    return "unresolved_discussions";
  }

  if (pipelineStatus && runningPipelineStatuses.has(pipelineStatus)) {
    return "pipeline_running";
  }

  if (mergeRequest.mergeable === false) {
    return "blocked";
  }

  return "ready";
}

export function summarizeMergeRequestReviewState(mergeRequest: GraphQLMergeRequest): JsonMap {
  const unresolvedCount = unresolvedDiscussionCount(mergeRequest);
  const blockers = summarizeBlockers(mergeRequest, unresolvedCount);
  const status = determineReviewStatus(mergeRequest, unresolvedCount);
  const reviewers = takeNodes(mergeRequest.reviewers).map(toUserSummary);
  const approvedBy = takeNodes(mergeRequest.approvedBy).map(toUserSummary);
  const unresolvedDiscussions = takeNodes(mergeRequest.discussions)
    .filter((discussion) => discussion.resolvable === true && discussion.resolved !== true)
    .map((discussion) => ({
      id: discussion.id ?? null,
      resolved: discussion.resolved ?? false,
      resolvable: discussion.resolvable ?? false,
      resolved_at: discussion.resolvedAt ?? null,
      resolved_by: discussion.resolvedBy ? toUserSummary(discussion.resolvedBy) : null
    }));

  return {
    review_status: status,
    is_ready_for_merge: status === "ready",
    blockers,
    merge_request: {
      iid: mergeRequest.iid ?? null,
      title: mergeRequest.title ?? null,
      state: mergeRequest.state ?? null,
      draft: mergeRequest.draft ?? false,
      web_url: mergeRequest.webUrl ?? null,
      updated_at: mergeRequest.updatedAt ?? null,
      source_branch: mergeRequest.sourceBranch ?? null,
      target_branch: mergeRequest.targetBranch ?? null,
      detailed_merge_status: mergeRequest.detailedMergeStatus ?? null,
      mergeable: mergeRequest.mergeable ?? null,
      mergeable_discussions_state: mergeRequest.mergeableDiscussionsState ?? null
    },
    approvals: {
      approved: mergeRequest.approved ?? null,
      approvals_required: mergeRequest.approvalsRequired ?? 0,
      approvals_left: mergeRequest.approvalsLeft ?? 0,
      approved_by: approvedBy
    },
    reviewers,
    discussion_status: {
      resolvable_discussions_count: mergeRequest.resolvableDiscussionsCount ?? 0,
      resolved_discussions_count: mergeRequest.resolvedDiscussionsCount ?? 0,
      unresolved_discussions_count: unresolvedCount,
      sampled_unresolved_discussions: unresolvedDiscussions
    },
    diff_stats: {
      additions: mergeRequest.diffStatsSummary?.additions ?? 0,
      deletions: mergeRequest.diffStatsSummary?.deletions ?? 0,
      changes: mergeRequest.diffStatsSummary?.changes ?? 0,
      file_count: mergeRequest.diffStatsSummary?.fileCount ?? 0
    },
    labels: takeNodes(mergeRequest.labels)
      .map((label) => label.title)
      .filter((label): label is string => typeof label === "string" && label.length > 0),
    head_pipeline: mergeRequest.headPipeline
      ? {
          id: mergeRequest.headPipeline.id ?? null,
          iid: mergeRequest.headPipeline.iid ?? null,
          path: mergeRequest.headPipeline.path ?? null,
          status: mergeRequest.headPipeline.status ?? null,
          failed_jobs_count: mergeRequest.headPipeline.failedJobsCount ?? 0,
          ref: mergeRequest.headPipeline.ref ?? null,
          sha: mergeRequest.headPipeline.sha ?? null,
          updated_at: mergeRequest.headPipeline.updatedAt ?? null,
          detailed_status: {
            text: mergeRequest.headPipeline.detailedStatus?.text ?? null,
            label: mergeRequest.headPipeline.detailedStatus?.label ?? null,
            group: mergeRequest.headPipeline.detailedStatus?.group ?? null,
            icon: mergeRequest.headPipeline.detailedStatus?.icon ?? null
          }
        }
      : null
  };
}

export function registerReviewStateTools(deps: ToolDeps): void {
  const graphqlClient = new GitLabGraphQLClient(deps.config);

  registerTool(deps, {
    name: "gitlab_get_merge_request_review_state",
    title: "Get Merge Request Review State",
    description:
      "Summarize merge request review readiness, approvals, discussions, reviewers, and head pipeline state through a single GraphQL-backed aggregate query.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      reviewer_limit: z.number().int().positive().max(50).optional().default(10),
      discussion_limit: z.number().int().positive().max(50).optional().default(20),
      label_limit: z.number().int().positive().max(50).optional().default(20)
    },
    handler: async (args, { requireProject }) => {
      const project = await requireProject(args.project_id);
      const projectPath = typeof project.path_with_namespace === "string"
        ? project.path_with_namespace
        : null;

      if (!projectPath) {
        throw new Error("GitLab did not return a project path that can be used for GraphQL queries.");
      }

      const response = await graphqlClient.query<ReviewStateQueryResult>(
        MERGE_REQUEST_REVIEW_STATE_QUERY,
        {
          projectPath,
          mergeRequestIid: String(args.merge_request_iid),
          reviewerLimit: args.reviewer_limit,
          discussionLimit: args.discussion_limit,
          labelLimit: args.label_limit
        }
      );

      const resultProject = response.project ?? null;
      const mergeRequest = resultProject?.mergeRequest ?? null;

      if (!resultProject || !mergeRequest) {
        throw new Error("GitLab could not find the requested merge request.");
      }

      return {
        source: "graphql",
        project: {
          full_path: resultProject.fullPath ?? projectPath,
          web_url: resultProject.webUrl ?? null
        },
        ...summarizeMergeRequestReviewState(mergeRequest)
      };
    }
  });
}

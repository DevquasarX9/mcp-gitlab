import { z } from "zod";

import type { GitLabClient } from "../gitlab/client.js";
import type { JsonMap } from "../gitlab/types.js";
import { stripUnsafeText, validateRef, validateRepositoryPath } from "../security/guards.js";
import { cleanQuery, registerTool, type ToolDeps } from "./shared.js";
import {
  formatDirectorySummaryMarkdown,
  formatCommitRangeSummaryMarkdown,
  formatFailedPipelineMarkdown,
  formatFlakyCiTriageMarkdown,
  formatPortfolioDeliveryOverviewMarkdown,
  formatMergeRequestRiskMarkdown,
  formatReleaseReadinessMarkdown,
  formatProjectStatusMarkdown,
  formatReleaseNotesMarkdown,
  formatStaleMergeRequestCleanupMarkdown,
  formatTeamDeliveryDigestMarkdown,
  outputFormatSchema,
  presentOutput
} from "./output.js";
import { comparePipelineJobSets, detectFlakyJobs } from "./pipelines.js";
import { requireAllowedGroup } from "./groups.js";

export const blockedStatuses = new Set([
  "approvals_syncing",
  "checking",
  "ci_must_pass",
  "ci_still_running",
  "commits_status",
  "conflict",
  "discussions_not_resolved",
  "draft_status",
  "jira_association_missing",
  "locked_paths",
  "merge_request_blocked",
  "not_approved",
  "pipeline_must_succeed"
]);

export function isBlockedMergeStatus(status: unknown): boolean {
  return typeof status === "string" && blockedStatuses.has(status.toLowerCase());
}

function daysOld(iso: unknown): number | null {
  if (typeof iso !== "string" || iso.length === 0) {
    return null;
  }

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function takeArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function issueKey(issue: JsonMap): string {
  return `${issue.project_id ?? "unknown"}:${issue.iid ?? issue.id ?? "unknown"}`;
}

function isDraftMergeRequest(mergeRequest: JsonMap): boolean {
  return Boolean(mergeRequest.draft) || String(mergeRequest.title ?? "").startsWith("Draft:");
}

function mergeRequestNeedsAttention(mergeRequest: JsonMap): boolean {
  return isDraftMergeRequest(mergeRequest) || isBlockedMergeStatus(mergeRequest.detailed_merge_status);
}

function summarizePipelineStatus(pipelines: readonly JsonMap[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const pipeline of pipelines) {
    const status = typeof pipeline.status === "string" ? pipeline.status : "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }

  return counts;
}

function representativePath(diff: JsonMap): string | null {
  return asString(diff.new_path) ?? asString(diff.old_path);
}

function topLevelDirectory(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);

  if (segments.length <= 1) {
    return "(root)";
  }

  return segments[0] ?? "(root)";
}

function pathDepth(path: string): number {
  return path.replace(/^\/+|\/+$/g, "").split("/").filter((segment) => segment.length > 0).length;
}

function fileExtension(path: string): string {
  const normalized = path.split("/").pop() ?? path;
  const dotIndex = normalized.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return "(none)";
  }

  return normalized.slice(dotIndex).toLowerCase();
}

function normalizeStatus(status: unknown): string {
  return typeof status === "string" ? status.toLowerCase() : "";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const activePipelineStatuses = new Set([
  "created",
  "manual",
  "pending",
  "preparing",
  "running",
  "scheduled",
  "waiting_for_resource"
]);

export function categorizeReleaseCommits(commits: readonly JsonMap[]): {
  readonly features: readonly JsonMap[];
  readonly fixes: readonly JsonMap[];
  readonly chores: readonly JsonMap[];
  readonly other: readonly JsonMap[];
} {
  return {
    features: commits.filter((commit) => String(commit.title ?? "").startsWith("feat")),
    fixes: commits.filter((commit) => String(commit.title ?? "").startsWith("fix")),
    chores: commits.filter((commit) => String(commit.title ?? "").startsWith("chore")),
    other: commits.filter((commit) => {
      const title = String(commit.title ?? "");
      return !title.startsWith("feat") && !title.startsWith("fix") && !title.startsWith("chore");
    })
  };
}

function classifyNotableFile(path: string): string | null {
  if (path.includes(".gitlab-ci") || path.startsWith(".github/") || path.startsWith(".gitlab/")) {
    return "Touches CI or automation configuration.";
  }

  if (
    /(^|\/)(Dockerfile|docker-compose|helm\/|k8s\/|terraform\/|infra\/|deployment\/|deploy\/)/i.test(path)
  ) {
    return "Touches delivery or infrastructure surfaces.";
  }

  if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|composer\.(json|lock)|Gemfile\.lock|go\.(mod|sum)|Cargo\.(toml|lock))/i.test(path)) {
    return "Touches dependency definitions or lockfiles.";
  }

  if (/(^|\/)(db\/|migrations\/|schema\/|prisma\/|sequelize\/)/i.test(path)) {
    return "Touches schema or migration code.";
  }

  if (/(^|\/)(auth|security|permissions|secrets?)/i.test(path)) {
    return "Touches authentication, authorization, or security-sensitive code.";
  }

  return null;
}

function classifyDirectoryKeyFile(path: string): string | null {
  const normalized = path.toLowerCase();

  if (normalized.endsWith("/readme.md") || normalized === "readme.md") {
    return "Likely human-oriented entry point or usage guide.";
  }

  if (/(^|\/)(package\.json|composer\.json|pyproject\.toml|go\.mod|cargo\.toml)$/i.test(path)) {
    return "Dependency or project manifest.";
  }

  if (/(^|\/)(dockerfile|docker-compose\.ya?ml|makefile)$/i.test(path)) {
    return "Build or runtime entry surface.";
  }

  if (/(^|\/)(index|main|app|server)\.(ts|tsx|js|jsx|php|py|rb|go|java|kt)$/i.test(path)) {
    return "Likely executable or application entry file.";
  }

  if (/(^|\/)(\.env\.example|config\.(ts|js|php|json|ya?ml)|settings\.(ts|js|php|json|ya?ml))$/i.test(path)) {
    return "Configuration entry point.";
  }

  return null;
}

export function summarizeDirectoryAssessment(input: {
  readonly project: JsonMap;
  readonly path: string;
  readonly ref: string;
  readonly recursive: boolean;
  readonly items: readonly JsonMap[];
}): JsonMap {
  const files = input.items.filter((item) => asString(item.type) === "blob");
  const directories = input.items.filter((item) => asString(item.type) === "tree");
  const extensionCounts = new Map<string, number>();
  const subdirectoryCounts = new Map<string, number>();
  const keyFiles: JsonMap[] = [];
  let maxDepth = 0;

  for (const item of input.items) {
    const path = asString(item.path);
    if (path === null) {
      continue;
    }

    maxDepth = Math.max(maxDepth, Math.max(0, pathDepth(path) - (input.path.length > 0 ? pathDepth(input.path) : 0)));

    if (asString(item.type) === "blob") {
      const extension = fileExtension(path);
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
      const reason = classifyDirectoryKeyFile(path);
      if (reason !== null) {
        keyFiles.push({ path, reason });
      }
    } else if (asString(item.type) === "tree") {
      const relativePath = input.path.length > 0 && path.startsWith(`${input.path}/`)
        ? path.slice(input.path.length + 1)
        : path;
      const topSegment = relativePath.split("/").find((segment) => segment.length > 0);
      if (topSegment) {
        subdirectoryCounts.set(topSegment, (subdirectoryCounts.get(topSegment) ?? 0) + 1);
      }
    }
  }

  const topFileTypes = [...extensionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([extension, fileCount]) => ({
      extension,
      file_count: fileCount
    }));
  const topSubdirectories = [...subdirectoryCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([path, changedFileCount]) => ({
      path,
      changed_file_count: changedFileCount
    }));

  const appLikeExtensions = [".ts", ".tsx", ".js", ".jsx", ".php", ".py", ".rb", ".go", ".java", ".kt", ".cs"];
  const testLikeExtensions = [".spec.ts", ".test.ts", ".spec.js", ".test.js", ".feature"];
  const appCodeCount = files.filter((item) => {
    const path = asString(item.path) ?? "";
    return appLikeExtensions.some((extension) => path.endsWith(extension));
  }).length;
  const testCodeCount = files.filter((item) => {
    const path = asString(item.path) ?? "";
    return testLikeExtensions.some((extension) => path.endsWith(extension)) || path.includes("/test") || path.includes("/spec");
  }).length;
  const docCount = files.filter((item) => {
    const path = (asString(item.path) ?? "").toLowerCase();
    return path.endsWith(".md") || path.endsWith(".rst") || path.includes("/docs/");
  }).length;
  const configCount = keyFiles.filter((entry) => {
    const reason = asString(entry.reason) ?? "";
    return reason.includes("Configuration") || reason.includes("manifest") || reason.includes("Build");
  }).length;
  const infraCount = files.filter((item) => {
    const path = asString(item.path) ?? "";
    return classifyNotableFile(path) === "Touches delivery or infrastructure surfaces." ||
      classifyNotableFile(path) === "Touches CI or automation configuration.";
  }).length;

  let directoryProfile = "mixed";
  if (docCount > Math.max(appCodeCount, testCodeCount, configCount, infraCount)) {
    directoryProfile = "documentation";
  } else if (testCodeCount > Math.max(appCodeCount, configCount, infraCount)) {
    directoryProfile = "tests";
  } else if (configCount > Math.max(appCodeCount, testCodeCount, infraCount)) {
    directoryProfile = "configuration";
  } else if (infraCount > Math.max(appCodeCount, testCodeCount, configCount)) {
    directoryProfile = "infrastructure";
  } else if (appCodeCount > 0) {
    directoryProfile = "application";
  } else if (files.length === 0 && directories.length > 0) {
    directoryProfile = "container";
  }

  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (files.length + directories.length >= 150) {
    warnings.push("The sampled directory is large, so this summary is structural rather than exhaustive.");
    nextActions.push("Narrow the path and rerun the summary if you need a more focused view.");
  }

  if (maxDepth >= 4) {
    warnings.push("The sampled directory has a relatively deep nested structure.");
    nextActions.push("Inspect the deepest subdirectories next if you are tracing ownership or code flow.");
  }

  if (keyFiles.length === 0) {
    warnings.push("No obvious manifest, README, or entry file was detected in the sampled directory.");
    nextActions.push("Open a representative file or list a narrower subtree to understand this area better.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Start with the detected key files, then inspect the top subdirectories.");
  }

  const summary =
    directoryProfile === "application"
      ? "This directory looks primarily application-oriented based on the file types and entry-file heuristics in the sampled tree."
      : directoryProfile === "tests"
        ? "This directory looks primarily test-oriented based on the sampled tree."
        : directoryProfile === "configuration"
          ? "This directory looks configuration-heavy based on manifests, config files, or build entry points."
          : directoryProfile === "infrastructure"
            ? "This directory looks infrastructure or delivery-oriented based on the sampled paths."
            : directoryProfile === "documentation"
              ? "This directory looks documentation-heavy based on the sampled files."
              : directoryProfile === "container"
                ? "This path currently looks like a structural container directory with nested subdirectories."
                : "This directory has a mixed structure, so the key files and dominant file types are the best starting point.";

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    path: input.path.length > 0 ? input.path : "(root)",
    ref: input.ref,
    recursive: input.recursive,
    directory_profile: directoryProfile,
    summary,
    warnings,
    next_actions: nextActions,
    signals: {
      total_entry_count: input.items.length,
      file_count: files.length,
      directory_count: directories.length,
      max_depth: maxDepth
    },
    highlights: {
      key_files: keyFiles.slice(0, 10),
      top_subdirectories: topSubdirectories.slice(0, 10),
      top_file_types: topFileTypes.slice(0, 10)
    },
    content_is_untrusted: true
  };
}

export function summarizeCommitRangeAssessment(input: {
  readonly project: JsonMap;
  readonly fromRef: string;
  readonly toRef: string;
  readonly commits: readonly JsonMap[];
  readonly diffs: readonly JsonMap[];
  readonly categories: {
    readonly features: readonly JsonMap[];
    readonly fixes: readonly JsonMap[];
    readonly chores: readonly JsonMap[];
    readonly other: readonly JsonMap[];
  };
}): JsonMap {
  const directoryCounts = new Map<string, number>();
  const notableFiles: JsonMap[] = [];
  let newFileCount = 0;
  let deletedFileCount = 0;
  let renamedFileCount = 0;
  let ciTouchCount = 0;
  let dependencyTouchCount = 0;
  let dataModelTouchCount = 0;

  for (const diff of input.diffs) {
    const path = representativePath(diff);
    if (path === null) {
      continue;
    }

    directoryCounts.set(topLevelDirectory(path), (directoryCounts.get(topLevelDirectory(path)) ?? 0) + 1);

    if (diff.new_file === true) {
      newFileCount += 1;
    }

    if (diff.deleted_file === true) {
      deletedFileCount += 1;
    }

    if (diff.renamed_file === true) {
      renamedFileCount += 1;
    }

    const reason = classifyNotableFile(path);
    if (reason !== null) {
      notableFiles.push({ path, reason });
    }

    if (reason === "Touches CI or automation configuration.") {
      ciTouchCount += 1;
    } else if (reason === "Touches dependency definitions or lockfiles.") {
      dependencyTouchCount += 1;
    } else if (reason === "Touches schema or migration code.") {
      dataModelTouchCount += 1;
    }
  }

  const topDirectories = [...directoryCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([path, changedFileCount]) => ({
      path,
      changed_file_count: changedFileCount
    }));
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (input.diffs.length >= 40) {
    warnings.push(`This range touches ${input.diffs.length} files, which is a relatively broad change set.`);
    nextActions.push("Review the highest-churn directories first because the change set is broad.");
  }

  if (topDirectories.length >= 6) {
    warnings.push(`This range spans ${topDirectories.length} top-level directories, which suggests wide surface-area impact.`);
    nextActions.push("Confirm rollout and ownership across the directories touched by this range.");
  }

  if (ciTouchCount > 0) {
    warnings.push(`CI or automation files were touched in ${ciTouchCount} changed paths.`);
    nextActions.push("Double-check CI and automation changes before relying on the range summary alone.");
  }

  if (dependencyTouchCount > 0) {
    warnings.push(`Dependency definitions or lockfiles were touched in ${dependencyTouchCount} changed paths.`);
    nextActions.push("Review dependency updates for runtime, build, or supply-chain implications.");
  }

  if (dataModelTouchCount > 0) {
    warnings.push(`Schema or migration-related files were touched in ${dataModelTouchCount} changed paths.`);
    nextActions.push("Validate migration and data-shape changes before release or rollout.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Review the top changed directories and sampled commits for correctness and rollout context.");
  }

  const changeRisk =
    warnings.length >= 3 ? "elevated" : warnings.length > 0 ? "watch" : "routine";
  const summary =
    changeRisk === "elevated"
      ? "This commit range touches several operationally sensitive or broad areas and should be reviewed carefully."
      : changeRisk === "watch"
        ? "This commit range looks understandable, but it includes some paths or breadth that deserve extra review."
        : "This commit range looks relatively focused based on the sampled files, directories, and commit themes.";

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    from_ref: input.fromRef,
    to_ref: input.toRef,
    change_risk: changeRisk,
    summary,
    warnings,
    next_actions: nextActions,
    signals: {
      commit_count: input.commits.length,
      changed_file_count: input.diffs.length,
      changed_directory_count: topDirectories.length,
      feature_commit_count: input.categories.features.length,
      fix_commit_count: input.categories.fixes.length,
      chore_commit_count: input.categories.chores.length,
      other_commit_count: input.categories.other.length,
      new_file_count: newFileCount,
      deleted_file_count: deletedFileCount,
      renamed_file_count: renamedFileCount,
      ci_touch_count: ciTouchCount,
      dependency_touch_count: dependencyTouchCount,
      data_model_touch_count: dataModelTouchCount
    },
    highlights: {
      top_directories: topDirectories.slice(0, 8),
      notable_files: notableFiles.slice(0, 8),
      sampled_commits: input.commits.slice(0, 8)
    },
    content_is_untrusted: true
  };
}

export function summarizeReleaseReadinessAssessment(input: {
  readonly project: JsonMap;
  readonly targetRef: string;
  readonly latestPipeline: JsonMap | null;
  readonly failedPipelines: readonly JsonMap[];
  readonly openMergeRequests: readonly JsonMap[];
  readonly staleMergeRequests: readonly JsonMap[];
  readonly blockedMergeRequests: readonly JsonMap[];
  readonly unassignedIssues: readonly JsonMap[];
  readonly compareFromRef: string | null;
  readonly compareCommitCount: number;
  readonly releaseCategories: {
    readonly features: readonly JsonMap[];
    readonly fixes: readonly JsonMap[];
    readonly chores: readonly JsonMap[];
    readonly other: readonly JsonMap[];
  };
}): JsonMap {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];
  const latestPipelineStatus = normalizeStatus(input.latestPipeline?.status);

  if (input.failedPipelines.length > 0) {
    blockers.push(`Recent failed pipelines detected on ${input.targetRef}.`);
    nextActions.push("Investigate the recent failed pipelines on the target ref before releasing.");
  }

  if (input.blockedMergeRequests.length > 0) {
    blockers.push(`There are ${input.blockedMergeRequests.length} blocked open merge requests targeting the release path.`);
    nextActions.push("Resolve or remove blocked merge requests that would affect the release path.");
  }

  if (latestPipelineStatus.length === 0) {
    warnings.push("No recent pipeline was found for the target ref.");
    nextActions.push("Confirm that the release ref has a recent validated pipeline.");
  } else if (activePipelineStatuses.has(latestPipelineStatus)) {
    warnings.push(`Latest pipeline on ${input.targetRef} is still ${latestPipelineStatus}.`);
    nextActions.push("Wait for the latest pipeline to finish before making the final release decision.");
  } else if (latestPipelineStatus !== "success") {
    blockers.push(`Latest pipeline on ${input.targetRef} is ${latestPipelineStatus}.`);
    nextActions.push("Restore the latest pipeline on the target ref to a successful state.");
  }

  if (input.staleMergeRequests.length > 0) {
    warnings.push(`There are ${input.staleMergeRequests.length} stale open merge requests.`);
    nextActions.push("Triage stale merge requests so release scope and ownership are clear.");
  }

  if (input.unassignedIssues.length > 0) {
    warnings.push(`There are ${input.unassignedIssues.length} unassigned open issues.`);
    nextActions.push("Assign or explicitly defer unassigned open issues that may affect the release.");
  }

  if (input.compareFromRef === null) {
    warnings.push("No previous release tag or explicit from_ref was available for release-note comparison.");
    nextActions.push("Confirm the intended release baseline before announcing or tagging the release.");
  }

  if (input.compareCommitCount >= 50) {
    warnings.push(`The release compare includes ${input.compareCommitCount} commits, which is a relatively large batch.`);
    nextActions.push("Review the release scope carefully because the change batch is large.");
  }

  if (input.openMergeRequests.length >= 10) {
    warnings.push(`There are ${input.openMergeRequests.length} open merge requests in scope, which may indicate active churn.`);
    nextActions.push("Confirm that active merge requests are intentionally excluded or included in the release plan.");
  }

  const readinessStatus =
    blockers.length > 0 ? "hold" : warnings.length > 0 ? "caution" : "go";
  const summary =
    readinessStatus === "hold"
      ? "Release readiness is blocked by pipeline or merge-state issues that should be resolved first."
      : readinessStatus === "caution"
        ? "Release readiness looks plausible, but there are unresolved warnings that should be reviewed before proceeding."
        : "Release readiness looks good based on the current sampled project, pipeline, and issue signals.";

  if (nextActions.length === 0) {
    nextActions.push("Proceed with final release validation and stakeholder communication.");
  }

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    target_ref: input.targetRef,
    readiness_status: readinessStatus,
    summary,
    blockers,
    warnings,
    next_actions: nextActions,
    signals: {
      latest_pipeline_status: latestPipelineStatus.length > 0 ? latestPipelineStatus : null,
      failed_pipeline_sample_count: input.failedPipelines.length,
      blocked_merge_request_sample_count: input.blockedMergeRequests.length,
      stale_merge_request_sample_count: input.staleMergeRequests.length,
      unassigned_issue_sample_count: input.unassignedIssues.length,
      open_merge_request_sample_count: input.openMergeRequests.length,
      release_note_commit_count: input.compareCommitCount,
      compare_from_ref: input.compareFromRef,
      release_note_category_counts: {
        features: input.releaseCategories.features.length,
        fixes: input.releaseCategories.fixes.length,
        chores: input.releaseCategories.chores.length,
        other: input.releaseCategories.other.length
      }
    },
    highlights: {
      failed_pipelines: input.failedPipelines.slice(0, 5),
      blocked_merge_requests: input.blockedMergeRequests.slice(0, 5),
      stale_merge_requests: input.staleMergeRequests.slice(0, 5),
      unassigned_issues: input.unassignedIssues.slice(0, 5)
    },
    content_is_untrusted: true
  };
}

interface FlakyJobContext {
  readonly job: JsonMap;
  readonly trace_job_result: JsonMap | null;
}

export function summarizeFlakyCiTriageAssessment(input: {
  readonly project: JsonMap;
  readonly ref: string | null;
  readonly lookbackPipelineCount: number;
  readonly failedPipelines: readonly JsonMap[];
  readonly flakyJobs: readonly JsonMap[];
  readonly representativePipelineComparison: JsonMap | null;
  readonly flakyJobContexts: readonly FlakyJobContext[];
}): JsonMap {
  const nextActions: string[] = [];
  const warnings: string[] = [];

  const triageStatus =
    input.flakyJobs.length > 0
      ? "flaky_detected"
      : input.failedPipelines.length > 0
        ? "deterministic_failures_only"
        : input.lookbackPipelineCount < 3
          ? "insufficient_data"
          : "stable_or_no_signal";

  const summary =
    triageStatus === "flaky_detected"
      ? "Recent pipeline history shows jobs that oscillate between success and failure, which is a strong flaky CI signal."
      : triageStatus === "deterministic_failures_only"
        ? "There are failed pipelines, but the sampled job history does not show strong flaky-job oscillation yet."
        : triageStatus === "insufficient_data"
          ? "There is not enough recent pipeline history to make a strong flaky CI judgment."
          : "The sampled recent pipeline history does not show a strong flaky CI signal.";

  if (input.lookbackPipelineCount < 3) {
    warnings.push("Recent pipeline history is shallow, so the flaky-job signal is weak.");
    nextActions.push("Collect more pipeline history before making a strong flaky-versus-deterministic call.");
  }

  if (input.flakyJobs.length > 0) {
    nextActions.push("Triage the top oscillating jobs first and compare their last successful and failed runs.");
  }

  if (input.failedPipelines.length > 0) {
    nextActions.push("Review the most recent failed pipelines to confirm whether the failures cluster around the same jobs.");
  }

  if (input.representativePipelineComparison !== null) {
    nextActions.push("Use the representative pipeline comparison to isolate which jobs changed behavior between a passing and failing run.");
  }

  if (input.flakyJobContexts.length > 0) {
    nextActions.push("Check the commit and merge request context for the strongest flaky candidates before escalating to owners.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Continue monitoring CI history and rerun this triage when more pipeline samples exist.");
  }

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    ref: input.ref,
    triage_status: triageStatus,
    summary,
    warnings,
    next_actions: nextActions,
    signals: {
      lookback_pipeline_count: input.lookbackPipelineCount,
      failed_pipeline_sample_count: input.failedPipelines.length,
      likely_flaky_job_count: input.flakyJobs.length,
      jobs_with_context_count: input.flakyJobContexts.length
    },
    highlights: {
      likely_flaky_jobs: input.flakyJobs.slice(0, 5),
      failed_pipelines: input.failedPipelines.slice(0, 5),
      flaky_job_contexts: input.flakyJobContexts.slice(0, 3)
    },
    representative_pipeline_comparison:
      input.representativePipelineComparison ?? {
        left_pipeline: null,
        right_pipeline: null,
        comparison: {
          added_job_count: 0,
          removed_job_count: 0,
          status_change_count: 0,
          duration_change_count: 0
        }
      },
    content_is_untrusted: true
  };
}

interface StaleMergeRequestCleanupItemInput {
  readonly mergeRequest: JsonMap;
  readonly unresolvedDiscussionCount: number;
  readonly latestPipelineStatus: string | null;
}

function recommendStaleMergeRequestAction(input: StaleMergeRequestCleanupItemInput): {
  readonly recommendedAction: string;
  readonly reason: string;
} {
  const detailedMergeStatus = normalizeStatus(input.mergeRequest.detailed_merge_status);

  if (Boolean(input.mergeRequest.draft) || String(input.mergeRequest.title ?? "").startsWith("Draft:")) {
    return {
      recommendedAction: "close_or_reassign",
      reason: "The merge request is still a draft and appears to have stalled without recent progress."
    };
  }

  if (Boolean(input.mergeRequest.has_conflicts) || detailedMergeStatus === "conflict") {
    return {
      recommendedAction: "rebase_or_resolve_conflicts",
      reason: "The merge request cannot move forward until conflicts are resolved."
    };
  }

  if (input.latestPipelineStatus === "failed") {
    return {
      recommendedAction: "fix_pipeline",
      reason: "The latest merge request pipeline failed, so CI should be restored before review continues."
    };
  }

  if (input.unresolvedDiscussionCount > 0 || detailedMergeStatus === "discussions_not_resolved") {
    return {
      recommendedAction: "resolve_discussions",
      reason: "There are unresolved review discussions blocking the merge request from progressing."
    };
  }

  if (isBlockedMergeStatus(detailedMergeStatus)) {
    return {
      recommendedAction: "unblock_review_state",
      reason: `The merge request is currently blocked by merge status "${detailedMergeStatus}".`
    };
  }

  return {
    recommendedAction: "comment_for_owner_decision",
    reason: "The merge request looks inactive without a single obvious blocker, so ownership and intent should be clarified."
  };
}

export function summarizeStaleMergeRequestCleanupAssessment(input: {
  readonly project: JsonMap;
  readonly staleAfterDays: number;
  readonly staleMergeRequests: readonly JsonMap[];
  readonly blockedStaleMergeRequests: readonly JsonMap[];
  readonly cleanupItems: readonly JsonMap[];
}): JsonMap {
  const draftStaleMergeRequests = input.staleMergeRequests.filter(
    (mergeRequest) =>
      Boolean(mergeRequest.draft) || String(mergeRequest.title ?? "").startsWith("Draft:")
  );
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (input.blockedStaleMergeRequests.length > 0) {
    warnings.push(
      `${input.blockedStaleMergeRequests.length} stale merge requests are explicitly blocked by merge state.`
    );
    nextActions.push(
      "Start with the blocked stale merge requests because they have a clear unblock path and release-risk implications."
    );
  }

  if (draftStaleMergeRequests.length > 0) {
    warnings.push(`${draftStaleMergeRequests.length} stale merge requests are still drafts.`);
    nextActions.push("Confirm whether stale draft merge requests should be revived, reassigned, or closed.");
  }

  if (input.cleanupItems.some((item) => item.recommended_action === "fix_pipeline")) {
    nextActions.push("Repair failed merge request pipelines before asking reviewers to re-engage.");
  }

  if (input.cleanupItems.some((item) => item.recommended_action === "resolve_discussions")) {
    nextActions.push("Resolve or explicitly defer open review discussions on the oldest stale merge requests.");
  }

  if (nextActions.length === 0) {
    nextActions.push("No stale merge request cleanup is needed right now.");
  }

  const cleanupStatus =
    input.blockedStaleMergeRequests.length > 0
      ? "needs_unblock"
      : input.staleMergeRequests.length > 0
        ? "needs_triage"
        : "clean";

  const summary =
    cleanupStatus === "needs_unblock"
      ? "Several stale merge requests have explicit blockers and should be unblocked or closed before they continue to age."
      : cleanupStatus === "needs_triage"
        ? "There are stale merge requests that need ownership and disposition decisions, even if they are not formally blocked."
        : "No stale merge requests were found in the sampled open merge request set.";

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace: input.project.path_with_namespace ?? null,
      default_branch: input.project.default_branch ?? null
    },
    stale_after_days: input.staleAfterDays,
    cleanup_status: cleanupStatus,
    summary,
    warnings,
    next_actions: nextActions,
    signals: {
      stale_merge_request_count: input.staleMergeRequests.length,
      blocked_stale_merge_request_count: input.blockedStaleMergeRequests.length,
      draft_stale_merge_request_count: draftStaleMergeRequests.length
    },
    cleanup_items: input.cleanupItems,
    highlights: {
      stale_merge_requests: input.staleMergeRequests.slice(0, 5),
      blocked_stale_merge_requests: input.blockedStaleMergeRequests.slice(0, 5)
    },
    content_is_untrusted: true
  };
}

export function summarizeTeamDeliveryDigestAssessment(
  input:
    | {
        readonly scopeType: "project";
        readonly scope: JsonMap;
        readonly reportingWindowDays: number;
        readonly recentEventCount: number;
        readonly openMergeRequests: readonly JsonMap[];
        readonly openIssues: readonly JsonMap[];
        readonly pipelineSignals: readonly JsonMap[];
      }
    | {
        readonly scopeType: "group";
        readonly scope: JsonMap;
        readonly reportingWindowDays: number;
        readonly openMergeRequests: readonly JsonMap[];
        readonly openIssues: readonly JsonMap[];
        readonly sampledProjects: readonly JsonMap[];
      }
): JsonMap {
  const openMergeRequests = input.openMergeRequests;
  const mergeRequestsNeedingAttention = openMergeRequests.filter(mergeRequestNeedsAttention);
  const openIssues = input.openIssues;
  const unassignedIssues = openIssues.filter(
    (issue) => takeArray<JsonMap>(issue.assignees).length === 0
  );
  const warnings: string[] = [];
  const nextActions: string[] = [];

  let failedPipelineSignalCount = 0;
  let runningPipelineSignalCount = 0;
  let projectsNeedingAttention: readonly JsonMap[] = [];
  let failedPipelines: readonly JsonMap[] = [];

  if (input.scopeType === "project") {
    failedPipelines = input.pipelineSignals.filter(
      (pipeline) => normalizeStatus(pipeline.status) === "failed"
    );
    failedPipelineSignalCount = failedPipelines.length;
    runningPipelineSignalCount = input.pipelineSignals.filter((pipeline) =>
      activePipelineStatuses.has(normalizeStatus(pipeline.status))
    ).length;
  } else {
    projectsNeedingAttention = input.sampledProjects.filter(
      (project) => typeof project.attention_reason === "string" && project.attention_reason.length > 0
    );
    failedPipelineSignalCount = input.sampledProjects.filter(
      (project) => normalizeStatus(project.latest_pipeline_status) === "failed"
    ).length;
    runningPipelineSignalCount = input.sampledProjects.filter((project) =>
      activePipelineStatuses.has(normalizeStatus(project.latest_pipeline_status))
    ).length;
  }

  if (failedPipelineSignalCount > 0) {
    warnings.push(
      input.scopeType === "project"
        ? `${failedPipelineSignalCount} recent pipelines failed in the reporting window.`
        : `${failedPipelineSignalCount} sampled projects have a latest pipeline in failed state.`
    );
    nextActions.push(
      input.scopeType === "project"
        ? "Restore the failing project pipelines before broad delivery communication."
        : "Start with the sampled projects whose latest pipelines are failing."
    );
  }

  if (mergeRequestsNeedingAttention.length > 0) {
    warnings.push(`${mergeRequestsNeedingAttention.length} open merge requests need review attention.`);
    nextActions.push("Triage the blocked or draft merge requests that are slowing delivery flow.");
  }

  if (unassignedIssues.length > 0) {
    warnings.push(`${unassignedIssues.length} open issues do not currently have an assignee.`);
    nextActions.push("Assign or explicitly defer unowned issues so the team digest reflects clear ownership.");
  }

  if (runningPipelineSignalCount > 0) {
    warnings.push(
      input.scopeType === "project"
        ? `${runningPipelineSignalCount} recent pipelines are still running.`
        : `${runningPipelineSignalCount} sampled projects still have a latest pipeline in progress.`
    );
    nextActions.push("Wait for the active pipelines to finish before treating the digest as fully stable.");
  }

  if (input.scopeType === "group" && projectsNeedingAttention.length > 0) {
    nextActions.push("Focus first on the sampled projects that already show an explicit attention reason.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Share the digest and continue the current delivery cadence.");
  }

  const digestStatus =
    failedPipelineSignalCount > 0 ||
    mergeRequestsNeedingAttention.length > 0 ||
    unassignedIssues.length > 0 ||
    projectsNeedingAttention.length > 0
      ? "needs_attention"
      : runningPipelineSignalCount > 0
        ? "watch"
        : "healthy";

  const scopeLabel =
    input.scopeType === "project"
      ? asString(input.scope.path_with_namespace) ?? asString(input.scope.full_path) ?? "project"
      : asString(input.scope.full_path) ?? asString(input.scope.name) ?? "group";
  const activitySummary =
    input.scopeType === "project"
      ? `${input.recentEventCount} recent events in ${input.reportingWindowDays} days`
      : `${input.sampledProjects.length} sampled projects in ${input.reportingWindowDays} days`;
  const summary =
    digestStatus === "needs_attention"
      ? "Delivery is active, but the current signals show concrete items that need follow-up before this is a clean status update."
      : digestStatus === "watch"
        ? "Delivery looks broadly healthy, but there are still active pipeline signals worth watching."
        : "Delivery looks healthy in the current sample, with no major blockers surfaced by the digest.";
  const chatReadySummary =
    input.scopeType === "project"
      ? `${scopeLabel}: ${activitySummary}, ${openMergeRequests.length} open MRs, ${openIssues.length} open issues, ${failedPipelineSignalCount} failed pipelines, ${mergeRequestsNeedingAttention.length} MRs needing attention, ${unassignedIssues.length} unassigned issues.`
      : `${scopeLabel}: ${activitySummary}, ${openMergeRequests.length} open MRs, ${openIssues.length} open issues, ${projectsNeedingAttention.length} sampled projects needing attention, ${failedPipelineSignalCount} failed latest-pipeline signals, ${unassignedIssues.length} unassigned issues.`;

  return {
    scope_type: input.scopeType,
    scope:
      input.scopeType === "project"
        ? {
            id: input.scope.id ?? null,
            path_with_namespace:
              input.scope.path_with_namespace ?? input.scope.full_path ?? null,
            default_branch: input.scope.default_branch ?? null
          }
        : {
            id: input.scope.id ?? null,
            name: input.scope.name ?? null,
            full_path: input.scope.full_path ?? null,
            web_url: input.scope.web_url ?? null
          },
    reporting_window_days: input.reportingWindowDays,
    digest_status: digestStatus,
    summary,
    chat_ready_summary: chatReadySummary,
    warnings,
    next_actions: nextActions,
    signals: {
      recent_activity_event_count: input.scopeType === "project" ? input.recentEventCount : null,
      sampled_project_count: input.scopeType === "group" ? input.sampledProjects.length : null,
      open_merge_request_count: openMergeRequests.length,
      merge_requests_needing_attention_count: mergeRequestsNeedingAttention.length,
      open_issue_count: openIssues.length,
      unassigned_issue_count: unassignedIssues.length,
      failed_pipeline_signal_count: failedPipelineSignalCount,
      running_pipeline_signal_count: runningPipelineSignalCount,
      projects_needing_attention_count:
        input.scopeType === "group" ? projectsNeedingAttention.length : null
    },
    highlights: {
      merge_requests: mergeRequestsNeedingAttention.slice(0, 5),
      issues: unassignedIssues.slice(0, 5),
      failed_pipelines: failedPipelines.slice(0, 5),
      projects_needing_attention: projectsNeedingAttention.slice(0, 5)
    },
    content_is_untrusted: true
  };
}

export function summarizePortfolioProjectAssessment(input: {
  readonly project: JsonMap;
  readonly staleAfterDays: number;
  readonly openMergeRequests: readonly JsonMap[];
  readonly openIssues: readonly JsonMap[];
  readonly pipelineSignals: readonly JsonMap[];
}): JsonMap {
  const staleMergeRequests = input.openMergeRequests.filter((mergeRequest) => {
    const age = daysOld(mergeRequest.updated_at);
    return age !== null && age >= input.staleAfterDays;
  });
  const blockedMergeRequests = input.openMergeRequests.filter((mergeRequest) =>
    isBlockedMergeStatus(mergeRequest.detailed_merge_status)
  );
  const unassignedIssues = input.openIssues.filter(
    (issue) => takeArray<JsonMap>(issue.assignees).length === 0
  );
  const failedPipelines = input.pipelineSignals.filter(
    (pipeline) => normalizeStatus(pipeline.status) === "failed"
  );
  const runningPipelines = input.pipelineSignals.filter((pipeline) =>
    activePipelineStatuses.has(normalizeStatus(pipeline.status))
  );
  const attentionReasons: string[] = [];

  if (input.project.archived === true) {
    attentionReasons.push("Project is archived.");
  }

  if (failedPipelines.length > 0) {
    attentionReasons.push("Recent pipeline sample includes failures.");
  }

  if (blockedMergeRequests.length > 0) {
    attentionReasons.push("Open merge request sample includes blocked items.");
  }

  if (staleMergeRequests.length > 0) {
    attentionReasons.push("Open merge request sample includes stale items.");
  }

  if (unassignedIssues.length > 0) {
    attentionReasons.push("Open issue sample includes unassigned issues.");
  }

  const deliveryStatus =
    input.project.archived === true
      ? "archived"
      : attentionReasons.length > 0
        ? "needs_attention"
        : runningPipelines.length > 0
          ? "watch"
          : "healthy";

  return {
    project: {
      id: input.project.id ?? null,
      path_with_namespace:
        input.project.path_with_namespace ?? input.project.full_path ?? null,
      default_branch: input.project.default_branch ?? null,
      archived: input.project.archived ?? false
    },
    delivery_status: deliveryStatus,
    latest_pipeline_status: asString(input.pipelineSignals[0]?.status),
    attention_score:
      input.project.archived === true
        ? 0
        : failedPipelines.length * 4 +
          blockedMergeRequests.length * 3 +
          staleMergeRequests.length * 2 +
          unassignedIssues.length +
          runningPipelines.length,
    counts: {
      open_merge_requests: input.openMergeRequests.length,
      blocked_merge_requests: blockedMergeRequests.length,
      stale_merge_requests: staleMergeRequests.length,
      open_issues: input.openIssues.length,
      unassigned_issues: unassignedIssues.length,
      failed_pipelines: failedPipelines.length,
      running_pipelines: runningPipelines.length
    },
    attention_reasons: attentionReasons,
    highlights: {
      blocked_merge_requests: blockedMergeRequests.slice(0, 3),
      stale_merge_requests: staleMergeRequests.slice(0, 3),
      unassigned_issues: unassignedIssues.slice(0, 3),
      failed_pipelines: failedPipelines.slice(0, 3)
    }
  };
}

export function summarizePortfolioDeliveryOverviewAssessment(input: {
  readonly scopeType: "group" | "projects";
  readonly scope: JsonMap;
  readonly staleAfterDays: number;
  readonly projectSummaries: readonly JsonMap[];
}): JsonMap {
  const projectSummaries = [...input.projectSummaries].sort((left, right) => {
    const scoreDelta = (asNumber(right.attention_score) ?? 0) - (asNumber(left.attention_score) ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const leftPath = asString((left.project as JsonMap | undefined)?.path_with_namespace) ?? "";
    const rightPath = asString((right.project as JsonMap | undefined)?.path_with_namespace) ?? "";
    return leftPath.localeCompare(rightPath);
  });
  const activeProjectSummaries = projectSummaries.filter(
    (project) => asString(project.delivery_status) !== "archived"
  );
  const projectsNeedingAttention = activeProjectSummaries.filter(
    (project) => asString(project.delivery_status) === "needs_attention"
  );
  const projectsOnWatch = activeProjectSummaries.filter(
    (project) => asString(project.delivery_status) === "watch"
  );
  const failedPipelineSignalCount = activeProjectSummaries.reduce(
    (sum, project) => sum + (asNumber((project.counts as JsonMap | undefined)?.failed_pipelines) ?? 0),
    0
  );
  const blockedMergeRequestCount = activeProjectSummaries.reduce(
    (sum, project) => sum + (asNumber((project.counts as JsonMap | undefined)?.blocked_merge_requests) ?? 0),
    0
  );
  const staleMergeRequestCount = activeProjectSummaries.reduce(
    (sum, project) => sum + (asNumber((project.counts as JsonMap | undefined)?.stale_merge_requests) ?? 0),
    0
  );
  const unassignedIssueCount = activeProjectSummaries.reduce(
    (sum, project) => sum + (asNumber((project.counts as JsonMap | undefined)?.unassigned_issues) ?? 0),
    0
  );
  const nextActions: string[] = [];

  if (projectsNeedingAttention.length > 0) {
    nextActions.push("Start with the highest-risk projects in the portfolio before broad status reporting.");
  }

  if (failedPipelineSignalCount > 0) {
    nextActions.push("Restore the failing project pipelines that are driving portfolio risk.");
  }

  if (blockedMergeRequestCount > 0) {
    nextActions.push("Resolve blocked merge requests in the highlighted projects so delivery flow can resume.");
  }

  if (unassignedIssueCount > 0) {
    nextActions.push("Assign or explicitly defer unowned issues across the highlighted projects.");
  }

  if (nextActions.length === 0) {
    nextActions.push("Share the portfolio summary and keep monitoring the sampled projects.");
  }

  const portfolioStatus =
    projectsNeedingAttention.length > 0
      ? "needs_attention"
      : projectsOnWatch.length > 0
        ? "watch"
        : "healthy";
  const scopeLabel =
    input.scopeType === "group"
      ? asString(input.scope.full_path) ?? asString(input.scope.name) ?? "group"
      : asString(input.scope.name) ?? "selected projects";
  const summary =
    portfolioStatus === "needs_attention"
      ? "The sampled portfolio includes projects with concrete delivery risks that should be addressed before this is treated as a clean group status."
      : portfolioStatus === "watch"
        ? "The sampled portfolio looks mostly healthy, but some projects still have active signals worth watching."
        : "The sampled portfolio looks healthy in the current delivery snapshot.";
  const chatReadySummary =
    `${scopeLabel}: ${activeProjectSummaries.length} projects sampled, ${projectsNeedingAttention.length} needing attention, ${projectsOnWatch.length} on watch, ${failedPipelineSignalCount} failed pipeline signals, ${blockedMergeRequestCount} blocked MRs, ${staleMergeRequestCount} stale MRs, ${unassignedIssueCount} unassigned issues.`;

  return {
    scope_type: input.scopeType,
    scope:
      input.scopeType === "group"
        ? {
            id: input.scope.id ?? null,
            name: input.scope.name ?? null,
            full_path: input.scope.full_path ?? null,
            web_url: input.scope.web_url ?? null
          }
        : {
            name: input.scope.name ?? "selected projects",
            project_ids: input.scope.project_ids ?? []
          },
    stale_after_days: input.staleAfterDays,
    portfolio_status: portfolioStatus,
    summary,
    chat_ready_summary: chatReadySummary,
    next_actions: nextActions,
    signals: {
      project_count: activeProjectSummaries.length,
      projects_needing_attention_count: projectsNeedingAttention.length,
      projects_on_watch_count: projectsOnWatch.length,
      failed_pipeline_signal_count: failedPipelineSignalCount,
      blocked_merge_request_count: blockedMergeRequestCount,
      stale_merge_request_count: staleMergeRequestCount,
      unassigned_issue_count: unassignedIssueCount
    },
    project_summaries: projectSummaries,
    highlights: {
      top_risk_projects: projectSummaries.filter((project) => (asNumber(project.attention_score) ?? 0) > 0).slice(0, 5)
    },
    content_is_untrusted: true
  };
}

async function getFailedJobs(
  client: GitLabClient,
  projectId: string,
  pipelineId: number
): Promise<readonly JsonMap[]> {
  const response = await client.getJson<JsonMap[]>(
    `/projects/${encodeURIComponent(projectId)}/pipelines/${pipelineId}/jobs`,
    {
      query: {
        scope: ["failed"]
      }
    }
  );

  return response.data;
}

async function getTraceTail(
  client: GitLabClient,
  projectId: string,
  jobId: number,
  tailLines: number
): Promise<string> {
  const response = await client.getJson<string>(
    `/projects/${encodeURIComponent(projectId)}/jobs/${jobId}/trace`
  );

  const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  return stripUnsafeText(text.split("\n").slice(-tailLines).join("\n"), 12_000);
}

export function registerIntelligenceTools(deps: ToolDeps): void {
  registerTool(deps, {
    name: "gitlab_summarize_project_status",
    title: "Summarize Project Status",
    description:
      "Summarize current project health by combining project metadata, recent pipelines, open issues, and open merge requests.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const [pipelines, issues, mergeRequests] = await Promise.all([
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
          query: { per_page: 20 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
          query: { state: "opened", per_page: 20 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
          query: { state: "opened", per_page: 20 }
        })
      ]);

      const openMrs = mergeRequests.data;
      const staleMrs = openMrs.filter((mr) => {
        const age = daysOld(mr.updated_at);
        return age !== null && age >= 14;
      });

      const result = {
        project: {
          id: project.id,
          path_with_namespace: project.path_with_namespace,
          default_branch: project.default_branch
        },
        recent_pipeline_status_counts: summarizePipelineStatus(pipelines.data),
        open_issue_count_sample: issues.data.length,
        open_merge_request_count_sample: openMrs.length,
        stale_merge_request_count_sample: staleMrs.length,
        highlights: {
          failed_pipelines: pipelines.data.filter((pipeline) => pipeline.status === "failed").slice(0, 5),
          stale_merge_requests: staleMrs.slice(0, 5),
          unassigned_issues: issues.data.filter((issue) => takeArray(issue.assignees).length === 0).slice(0, 5)
        }
      };

      return presentOutput(args.output_format, result, formatProjectStatusMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_find_stale_merge_requests",
    title: "Find Stale Merge Requests",
    description: "Find open merge requests that have not been updated recently.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      stale_after_days: z.number().int().positive().optional().default(14),
      include_drafts: z.boolean().optional().default(false),
      per_page: z.number().int().positive().max(100).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: {
            state: "opened",
            scope: "all",
            per_page: args.per_page
          }
        }
      );

      const items = response.data.filter((mr) => {
        const draft = Boolean(mr.draft) || String(mr.title ?? "").startsWith("Draft:");
        if (!args.include_drafts && draft) {
          return false;
        }

        const age = daysOld(mr.updated_at);
        return age !== null && age >= args.stale_after_days;
      });

      return {
        items,
        stale_after_days: args.stale_after_days
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_blocked_merge_requests",
    title: "Find Blocked Merge Requests",
    description: "Find open merge requests whose detailed_merge_status indicates a merge blocker.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      per_page: z.number().int().positive().max(100).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: {
            state: "opened",
            scope: "all",
            per_page: args.per_page
          }
        }
      );

      const items = response.data.filter((mr) => {
        return isBlockedMergeStatus(mr.detailed_merge_status);
      });

      return {
        items
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_failed_pipelines",
    title: "Find Failed Pipelines",
    description: "Find recent failed pipelines for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().optional(),
      per_page: z.number().int().positive().max(100).optional().default(30)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines`,
        {
          query: cleanQuery({
            status: "failed",
            ref: args.ref,
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
    name: "gitlab_explain_failed_pipeline",
    title: "Explain Failed Pipeline",
    description:
      "Summarize a failed pipeline by listing failed jobs and tailing their traces. Job output is treated as untrusted.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      pipeline_id: z.number().int().positive(),
      trace_tail_lines: z.number().int().positive().max(200).optional().default(40),
      max_jobs: z.number().int().positive().max(10).optional().default(3),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const pipeline = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}`
      );
      const failedJobs = await getFailedJobs(client, args.project_id, args.pipeline_id);
      const selectedJobs = failedJobs.slice(0, args.max_jobs);

      const traceSamples = await Promise.all(
        selectedJobs.map(async (job) => {
          const jobId = typeof job.id === "number" ? job.id : null;
          if (!jobId) {
            return {
              job,
              trace_tail: ""
            };
          }

          return {
            job,
            trace_tail: await getTraceTail(client, args.project_id, jobId, args.trace_tail_lines)
          };
        })
      );

      const result = {
        pipeline: pipeline.data,
        failed_job_count: failedJobs.length,
        failed_jobs: traceSamples,
        content_is_untrusted: true
      };

      return presentOutput(args.output_format, result, formatFailedPipelineMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_review_merge_request_risks",
    title: "Review Merge Request Risks",
    description:
      "Assess merge request risk using merge status, diff volume, pipeline state, and changed-file heuristics.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const [mrResponse, diffResponse, pipelineResponse, discussionResponse] = await Promise.all([
        client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}`,
          {
            query: {
              include_diverged_commits_count: true
            }
          }
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/diffs`
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/pipelines`
        ),
        client.getJson<JsonMap[]>(
          `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/discussions`
        )
      ]);

      const mr = mrResponse.data;
      const diffs = diffResponse.data;
      const changedPaths = diffs.flatMap((item) =>
        [item.new_path, item.old_path].filter((value): value is string => typeof value === "string")
      );

      const risks: string[] = [];

      if (mr.has_conflicts === true) {
        risks.push("Merge request has conflicts.");
      }

      if (typeof mr.detailed_merge_status === "string" && blockedStatuses.has(mr.detailed_merge_status)) {
        risks.push(`Merge is currently blocked by status: ${mr.detailed_merge_status}.`);
      }

      if (diffs.length >= 40) {
        risks.push(`Large change set: ${diffs.length} changed files.`);
      }

      if (changedPaths.some((path) => path.includes(".gitlab-ci"))) {
        risks.push("Touches CI configuration.");
      }

      if (changedPaths.some((path) => path.includes("Dockerfile") || path.includes("helm/"))) {
        risks.push("Touches delivery or deployment surfaces.");
      }

      const latestPipeline = pipelineResponse.data[0];
      if (!latestPipeline || latestPipeline.status !== "success") {
        risks.push("Latest merge request pipeline is not successful.");
      }

      const unresolvedDiscussions = discussionResponse.data.filter((discussion) =>
        takeArray<JsonMap>(discussion.notes).some((note) => note.resolvable === true && note.resolved !== true)
      );
      if (unresolvedDiscussions.length > 0) {
        risks.push(`There are ${unresolvedDiscussions.length} unresolved discussion threads.`);
      }

      const result = {
        merge_request: mr,
        changed_file_count: diffs.length,
        latest_pipeline: latestPipeline ?? null,
        unresolved_discussion_count: unresolvedDiscussions.length,
        risks,
        risk_level:
          risks.length >= 4 ? "high" : risks.length >= 2 ? "medium" : risks.length === 1 ? "low" : "minimal"
      };

      return presentOutput(args.output_format, result, formatMergeRequestRiskMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_generate_release_notes",
    title: "Generate Release Notes",
    description:
      "Generate draft release notes from repository compare results between two refs. Repository text is treated as untrusted.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      from_ref: z.string().trim().optional(),
      to_ref: z.string().trim().optional(),
      limit_commits: z.number().int().positive().max(200).optional().default(100),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const releases = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/releases`,
        {
          query: { per_page: 2 }
        }
      );

      const inferredFromRef =
        args.from_ref ??
        (typeof releases.data[0]?.tag_name === "string" ? releases.data[0].tag_name : undefined);
      const inferredToRef =
        args.to_ref ?? (typeof project.default_branch === "string" ? project.default_branch : "HEAD");

      const compareResponse = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/compare`,
        {
          query: cleanQuery({
            from: inferredFromRef,
            to: inferredToRef
          })
        }
      );

      const commits = takeArray<JsonMap>(compareResponse.data.commits).slice(0, args.limit_commits);
      const categories = categorizeReleaseCommits(commits);

      const result = {
        from_ref: inferredFromRef ?? null,
        to_ref: inferredToRef,
        commit_count: commits.length,
        categories,
        content_is_untrusted: true
      };

      return presentOutput(args.output_format, result, formatReleaseNotesMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_summarize_commit_range",
    title: "Summarize Commit Range",
    description:
      "Summarize what changed between two refs, highlight the most-affected directories, and flag risky repository surfaces.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      from_ref: z.string().trim().min(1),
      to_ref: z.string().trim().optional(),
      straight: z.boolean().optional(),
      max_commits: z.number().int().positive().max(200).optional().default(100),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const toRef =
        typeof args.to_ref === "string" && args.to_ref.length > 0
          ? args.to_ref
          : typeof project.default_branch === "string" && project.default_branch.length > 0
            ? project.default_branch
            : "HEAD";

      const compareResponse = await client.getJson<JsonMap>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/compare`,
        {
          query: cleanQuery({
            from: args.from_ref,
            to: toRef,
            straight: args.straight
          })
        }
      );

      const commits = takeArray<JsonMap>(compareResponse.data.commits).slice(0, args.max_commits);
      const diffs = takeArray<JsonMap>(compareResponse.data.diffs);
      const categories = categorizeReleaseCommits(commits);
      const result = summarizeCommitRangeAssessment({
        project,
        fromRef: args.from_ref,
        toRef,
        commits,
        diffs,
        categories
      });

      return presentOutput(args.output_format, result, formatCommitRangeSummaryMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_summarize_directory",
    title: "Summarize Directory",
    description:
      "Summarize a repository directory by sampling its tree structure, dominant file types, and likely entry files.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      path: z.string().trim().optional(),
      ref: z.string().trim().optional(),
      recursive: z.boolean().optional().default(true),
      max_entries: z.number().int().positive().max(200).optional().default(100),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const safePath = args.path ? validateRepositoryPath(args.path) : "";
      const safeRef =
        typeof args.ref === "string" && args.ref.length > 0
          ? validateRef(args.ref)
          : typeof project.default_branch === "string" && project.default_branch.length > 0
            ? project.default_branch
            : "HEAD";

      const treeResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/repository/tree`,
        {
          query: cleanQuery({
            path: safePath.length > 0 ? safePath : undefined,
            ref: safeRef,
            recursive: args.recursive,
            per_page: args.max_entries
          })
        }
      );

      const result = summarizeDirectoryAssessment({
        project,
        path: safePath,
        ref: safeRef,
        recursive: args.recursive,
        items: treeResponse.data
      });

      return presentOutput(args.output_format, result, formatDirectorySummaryMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_release_readiness_check",
    title: "Release Readiness Check",
    description:
      "Assess whether a project looks ready for release by combining pipeline, merge request, issue, and release comparison signals.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      target_ref: z.string().trim().optional(),
      stale_after_days: z.number().int().positive().max(90).optional().default(14),
      limit_commits: z.number().int().positive().max(200).optional().default(100),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const targetRef = typeof args.target_ref === "string" && args.target_ref.length > 0
        ? args.target_ref
        : typeof project.default_branch === "string" && project.default_branch.length > 0
          ? project.default_branch
          : "HEAD";

      const [recentPipelinesResponse, failedPipelinesResponse, mergeRequestsResponse, unassignedIssuesResponse, releasesResponse] =
        await Promise.all([
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
            query: { ref: targetRef, per_page: 10 }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
            query: { ref: targetRef, status: "failed", per_page: 10 }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
            query: {
              state: "opened",
              scope: "all",
              target_branch: targetRef,
              per_page: 50
            }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
            query: {
              state: "opened",
              assignee_id: "None",
              per_page: 20
            }
          }),
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/releases`, {
            query: { per_page: 2 }
          })
        ]);

      const openMergeRequests = mergeRequestsResponse.data;
      const staleMergeRequests = openMergeRequests.filter((mr) => {
        const age = daysOld(mr.updated_at);
        return age !== null && age >= args.stale_after_days;
      });
      const blockedMergeRequests = openMergeRequests.filter((mr) =>
        isBlockedMergeStatus(mr.detailed_merge_status)
      );

      const compareFromRef =
        typeof releasesResponse.data[0]?.tag_name === "string" ? releasesResponse.data[0].tag_name : null;

      let compareCommitCount = 0;
      let releaseCategories = categorizeReleaseCommits([]);

      if (compareFromRef !== null) {
        const compareResponse = await client.getJson<JsonMap>(
          `/projects/${encodeURIComponent(args.project_id)}/repository/compare`,
          {
            query: cleanQuery({
              from: compareFromRef,
              to: targetRef
            })
          }
        );

        const commits = takeArray<JsonMap>(compareResponse.data.commits).slice(0, args.limit_commits);
        compareCommitCount = commits.length;
        releaseCategories = categorizeReleaseCommits(commits);
      }

      const result = summarizeReleaseReadinessAssessment({
        project,
        targetRef,
        latestPipeline: recentPipelinesResponse.data[0] ?? null,
        failedPipelines: failedPipelinesResponse.data,
        openMergeRequests,
        staleMergeRequests,
        blockedMergeRequests,
        unassignedIssues: unassignedIssuesResponse.data,
        compareFromRef,
        compareCommitCount,
        releaseCategories
      });

      return presentOutput(args.output_format, result, formatReleaseReadinessMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_flaky_ci_triage",
    title: "Flaky CI Triage",
    description:
      "Assess whether recent CI failures look flaky by combining pipeline history, job oscillation, representative comparisons, and commit/MR context.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      ref: z.string().trim().optional(),
      lookback_pipelines: z.number().int().positive().max(25).optional().default(12),
      min_samples: z.number().int().positive().max(20).optional().default(3),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);

      const pipelinesResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/pipelines`,
        {
          query: cleanQuery({
            ref: args.ref,
            per_page: args.lookback_pipelines
          })
        }
      );

      const pipelines = pipelinesResponse.data;
      const jobsByPipeline = await Promise.all(
        pipelines.map(async (pipeline) => {
          const pipelineId = asNumber(pipeline.id);
          if (pipelineId === null) {
            return {
              pipeline,
              jobs: [] as readonly JsonMap[]
            };
          }

          const response = await client.getJson<JsonMap[]>(
            `/projects/${encodeURIComponent(args.project_id)}/pipelines/${pipelineId}/jobs`,
            {
              query: {
                include_retried: false,
                per_page: 100
              }
            }
          );

          return {
            pipeline,
            jobs: response.data.map((job) => ({
              ...job,
              pipeline_id: pipelineId,
              pipeline_status: pipeline.status,
              pipeline_ref: pipeline.ref
            }))
          };
        })
      );

      const allJobRuns = jobsByPipeline.flatMap((entry) => entry.jobs);
      const flakyJobs = detectFlakyJobs(allJobRuns, args.min_samples);
      const failedPipelines = pipelines.filter((pipeline) => normalizeStatus(pipeline.status) === "failed");
      const latestFailedPipeline = failedPipelines[0] ?? null;
      const latestSuccessfulPipeline =
        pipelines.find((pipeline) => normalizeStatus(pipeline.status) === "success") ?? null;

      let representativePipelineComparison: JsonMap | null = null;

      if (latestFailedPipeline && latestSuccessfulPipeline) {
        const leftPipelineId = asNumber(latestSuccessfulPipeline.id);
        const rightPipelineId = asNumber(latestFailedPipeline.id);

        if (leftPipelineId !== null && rightPipelineId !== null) {
          const leftJobs = jobsByPipeline.find((entry) => asNumber(entry.pipeline.id) === leftPipelineId)?.jobs ?? [];
          const rightJobs = jobsByPipeline.find((entry) => asNumber(entry.pipeline.id) === rightPipelineId)?.jobs ?? [];
          const comparison = comparePipelineJobSets(leftJobs, rightJobs);

          representativePipelineComparison = {
            left_pipeline: latestSuccessfulPipeline,
            right_pipeline: latestFailedPipeline,
            comparison: {
              ...comparison,
              added_job_count: takeArray(comparison.added_jobs).length,
              removed_job_count: takeArray(comparison.removed_jobs).length,
              status_change_count: takeArray(comparison.status_changes).length,
              duration_change_count: takeArray(comparison.duration_changes).length
            }
          };
        }
      }

      const flakyJobContexts = await Promise.all(
        flakyJobs.slice(0, 3).map(async (job) => {
          const recentRuns = takeArray<JsonMap>(job.recent_runs);
          const representativeRun =
            [...recentRuns].reverse().find((run) => normalizeStatus(run.status) === "failed") ??
            recentRuns[recentRuns.length - 1] ??
            null;
          const jobId = representativeRun ? asNumber(representativeRun.id) : null;

          if (jobId === null) {
            return {
              job,
              trace_job_result: null
            };
          }

          const jobResponse = await client.getJson<JsonMap>(
            `/projects/${encodeURIComponent(args.project_id)}/jobs/${jobId}`
          );
          const tracedJob = jobResponse.data;
          const commit = (tracedJob.commit as JsonMap | undefined) ?? null;
          const commitSha = commit ? asString(commit.id) : null;

          const mergeRequests = commitSha === null
            ? []
            : await client
                .getJson<JsonMap[]>(
                  `/projects/${encodeURIComponent(args.project_id)}/repository/commits/${encodeURIComponent(commitSha)}/merge_requests`,
                  {
                    query: { state: "all" }
                  }
                )
                .then((response) => response.data);

          return {
            job,
            trace_job_result: {
              job: tracedJob,
              commit,
              merge_requests: mergeRequests
            }
          };
        })
      );

      const result = summarizeFlakyCiTriageAssessment({
        project,
        ref: args.ref ?? (typeof project.default_branch === "string" ? project.default_branch : null),
        lookbackPipelineCount: pipelines.length,
        failedPipelines,
        flakyJobs,
        representativePipelineComparison,
        flakyJobContexts
      });

      return presentOutput(args.output_format, result, formatFlakyCiTriageMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_stale_merge_request_cleanup",
    title: "Stale Merge Request Cleanup",
    description:
      "Triage stale merge requests and recommend whether they should be merged, rebased, reassigned, commented on, or closed.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      stale_after_days: z.number().int().positive().max(90).optional().default(14),
      include_drafts: z.boolean().optional().default(false),
      per_page: z.number().int().positive().max(100).optional().default(50),
      max_detailed_items: z.number().int().positive().max(10).optional().default(5),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject }) => {
      const project = await requireProject(args.project_id);
      const mergeRequestsResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests`,
        {
          query: {
            state: "opened",
            scope: "all",
            per_page: args.per_page
          }
        }
      );

      const staleMergeRequests = mergeRequestsResponse.data.filter((mergeRequest) => {
        const draft =
          Boolean(mergeRequest.draft) || String(mergeRequest.title ?? "").startsWith("Draft:");
        if (!args.include_drafts && draft) {
          return false;
        }

        const age = daysOld(mergeRequest.updated_at);
        return age !== null && age >= args.stale_after_days;
      });
      const blockedStaleMergeRequests = staleMergeRequests.filter((mergeRequest) =>
        isBlockedMergeStatus(mergeRequest.detailed_merge_status)
      );

      const cleanupItems = await Promise.all(
        staleMergeRequests.slice(0, args.max_detailed_items).map(async (mergeRequest) => {
          const mergeRequestIid = asNumber(mergeRequest.iid);
          if (mergeRequestIid === null) {
            return {
              merge_request: mergeRequest,
              unresolved_discussion_count: 0,
              latest_pipeline_status: null,
              recommended_action: "comment_for_owner_decision",
              reason: "The merge request IID was missing, so detailed triage could not be completed."
            };
          }

          const [detailsResponse, pipelinesResponse, discussionsResponse] = await Promise.all([
            client.getJson<JsonMap>(
              `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${mergeRequestIid}`,
              {
                query: {
                  include_diverged_commits_count: true,
                  include_rebase_in_progress: true
                }
              }
            ),
            client.getJson<JsonMap[]>(
              `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${mergeRequestIid}/pipelines`
            ),
            client.getJson<JsonMap[]>(
              `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${mergeRequestIid}/discussions`
            )
          ]);

          const detailedMergeRequest = detailsResponse.data;
          const unresolvedDiscussionCount = discussionsResponse.data.filter((discussion) =>
            takeArray<JsonMap>(discussion.notes).some(
              (note) => note.resolvable === true && note.resolved !== true
            )
          ).length;
          const latestPipelineStatus = asString(pipelinesResponse.data[0]?.status);
          const recommendation = recommendStaleMergeRequestAction({
            mergeRequest: detailedMergeRequest,
            unresolvedDiscussionCount,
            latestPipelineStatus
          });

          return {
            merge_request: {
              iid: detailedMergeRequest.iid ?? mergeRequestIid,
              title: detailedMergeRequest.title ?? mergeRequest.title ?? null,
              web_url: detailedMergeRequest.web_url ?? mergeRequest.web_url ?? null,
              updated_at: detailedMergeRequest.updated_at ?? mergeRequest.updated_at ?? null,
              detailed_merge_status:
                detailedMergeRequest.detailed_merge_status ?? mergeRequest.detailed_merge_status ?? null,
              draft:
                detailedMergeRequest.draft ??
                mergeRequest.draft ??
                String(detailedMergeRequest.title ?? mergeRequest.title ?? "").startsWith("Draft:")
            },
            unresolved_discussion_count: unresolvedDiscussionCount,
            latest_pipeline_status: latestPipelineStatus,
            recommended_action: recommendation.recommendedAction,
            reason: recommendation.reason
          };
        })
      );

      const result = summarizeStaleMergeRequestCleanupAssessment({
        project,
        staleAfterDays: args.stale_after_days,
        staleMergeRequests,
        blockedStaleMergeRequests,
        cleanupItems
      });

      return presentOutput(args.output_format, result, formatStaleMergeRequestCleanupMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_team_delivery_digest",
    title: "Team Delivery Digest",
    description:
      "Generate a concise project or group delivery digest with health signals, notable blockers, and a chat-ready summary.",
    safety: "read-only",
    inputSchema: {
      scope_type: z.enum(["project", "group"]),
      scope_id: z.string().trim().min(1),
      days: z.number().int().positive().max(90).optional().default(7),
      project_sample_limit: z.number().int().positive().max(10).optional().default(5),
      per_page: z.number().int().positive().max(50).optional().default(20),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject, resolveProjectId, resolveGroupId }) => {
      const after = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

      if (args.scope_type === "project") {
        const projectId = resolveProjectId(args.scope_id);
        const project = await requireProject(projectId);
        const [eventsResponse, mergeRequestsResponse, issuesResponse, pipelinesResponse] =
          await Promise.all([
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/events`, {
              query: {
                after,
                per_page: 50
              }
            }),
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/merge_requests`, {
              query: {
                state: "opened",
                scope: "all",
                per_page: args.per_page
              }
            }),
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/issues`, {
              query: {
                state: "opened",
                per_page: args.per_page
              }
            }),
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/pipelines`, {
              query: {
                updated_after: after,
                per_page: args.per_page
              }
            })
          ]);

        const result = summarizeTeamDeliveryDigestAssessment({
          scopeType: "project",
          scope: project,
          reportingWindowDays: args.days,
          recentEventCount: eventsResponse.data.length,
          openMergeRequests: mergeRequestsResponse.data,
          openIssues: issuesResponse.data,
          pipelineSignals: pipelinesResponse.data
        });

        return presentOutput(args.output_format, result, formatTeamDeliveryDigestMarkdown);
      }

      const groupId = resolveGroupId(args.scope_id);
      const group = await requireAllowedGroup(groupId, deps);
      const [mergeRequestsResponse, issuesResponse, projectsResponse] = await Promise.all([
        client.getJson<JsonMap[]>(`/groups/${encodeURIComponent(groupId)}/merge_requests`, {
          query: {
            state: "opened",
            per_page: args.per_page
          }
        }),
        client.getJson<JsonMap[]>(`/groups/${encodeURIComponent(groupId)}/issues`, {
          query: {
            state: "opened",
            per_page: args.per_page
          }
        }),
        client.getJson<JsonMap[]>(`/groups/${encodeURIComponent(groupId)}/projects`, {
          query: cleanQuery({
            include_subgroups: true,
            order_by: "last_activity_at",
            sort: "desc",
            per_page: args.project_sample_limit
          })
        })
      ]);

      const sampledProjects = await Promise.all(
        projectsResponse.data
          .filter((project) => project.archived !== true)
          .slice(0, args.project_sample_limit)
          .map(async (project) => {
            const projectId = asNumber(project.id);

            if (projectId === null) {
              return {
                id: project.id ?? null,
                path_with_namespace:
                  project.path_with_namespace ?? project.path ?? project.name_with_namespace ?? null,
                latest_pipeline_status: null,
                attention_reason: null
              };
            }

            const pipelineResponse = await client.getJson<JsonMap[]>(
              `/projects/${encodeURIComponent(String(projectId))}/pipelines`,
              {
                query: {
                  per_page: 1
                }
              }
            );
            const latestPipeline = pipelineResponse.data[0] ?? null;
            const latestPipelineStatus = asString(latestPipeline?.status);
            let attentionReason: string | null = null;

            if (latestPipelineStatus === "failed") {
              attentionReason = "Latest sampled project pipeline is failing.";
            } else if (
              latestPipelineStatus !== null &&
              activePipelineStatuses.has(normalizeStatus(latestPipelineStatus))
            ) {
              attentionReason = "Latest sampled project pipeline is still running.";
            }

            return {
              id: projectId,
              path_with_namespace:
                project.path_with_namespace ?? project.path ?? project.name_with_namespace ?? null,
              last_activity_at: project.last_activity_at ?? null,
              latest_pipeline_status: latestPipelineStatus,
              attention_reason: attentionReason
            };
          })
      );

      const result = summarizeTeamDeliveryDigestAssessment({
        scopeType: "group",
        scope: {
          id: group.id ?? null,
          name: group.name ?? null,
          full_path: group.full_path ?? null,
          web_url: group.web_url ?? null
        },
        reportingWindowDays: args.days,
        openMergeRequests: mergeRequestsResponse.data,
        openIssues: issuesResponse.data,
        sampledProjects
      });

      return presentOutput(args.output_format, result, formatTeamDeliveryDigestMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_portfolio_delivery_overview",
    title: "Portfolio Delivery Overview",
    description:
      "Summarize delivery health across a group or an explicit set of projects and highlight the top risk hotspots.",
    safety: "read-only",
    inputSchema: {
      scope_type: z.enum(["group", "projects"]),
      scope_id: z.string().trim().optional(),
      project_ids: z.array(z.string().trim().min(1)).optional(),
      project_limit: z.number().int().positive().max(15).optional().default(5),
      per_page: z.number().int().positive().max(50).optional().default(20),
      pipeline_limit: z.number().int().positive().max(10).optional().default(5),
      stale_after_days: z.number().int().positive().max(90).optional().default(14),
      output_format: outputFormatSchema
    },
    handler: async (args, { client, requireProject, resolveProjectId, resolveGroupId }) => {
      let scope: JsonMap;
      let selectedProjectIds: readonly string[];

      if (args.scope_type === "group") {
        if (typeof args.scope_id !== "string" || args.scope_id.length === 0) {
          throw new Error("scope_id is required when scope_type is \"group\".");
        }

        const groupId = resolveGroupId(args.scope_id);
        const group = await requireAllowedGroup(groupId, deps);
        const projectsResponse = await client.getJson<JsonMap[]>(
          `/groups/${encodeURIComponent(groupId)}/projects`,
          {
            query: cleanQuery({
              include_subgroups: true,
              order_by: "last_activity_at",
              sort: "desc",
              per_page: args.project_limit
            })
          }
        );

        selectedProjectIds = [
          ...new Set(
            projectsResponse.data
              .filter((project) => project.archived !== true)
              .map((project) => asNumber(project.id))
              .filter((projectId): projectId is number => projectId !== null)
              .map((projectId) => String(projectId))
          )
        ];
        scope = {
          id: group.id ?? null,
          name: group.name ?? null,
          full_path: group.full_path ?? null,
          web_url: group.web_url ?? null
        };
      } else {
        if (!Array.isArray(args.project_ids) || args.project_ids.length === 0) {
          throw new Error("project_ids is required when scope_type is \"projects\".");
        }

        selectedProjectIds = [...new Set(args.project_ids.map((projectId) => resolveProjectId(projectId)))];
        scope = {
          name: "selected projects",
          project_ids: selectedProjectIds
        };
      }

      const projectSummaries = await Promise.all(
        selectedProjectIds.map(async (projectId) => {
          const project = await requireProject(projectId);
          const [mergeRequestsResponse, issuesResponse, pipelinesResponse] = await Promise.all([
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/merge_requests`, {
              query: {
                state: "opened",
                scope: "all",
                per_page: args.per_page
              }
            }),
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/issues`, {
              query: {
                state: "opened",
                per_page: args.per_page
              }
            }),
            client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(projectId)}/pipelines`, {
              query: {
                per_page: args.pipeline_limit
              }
            })
          ]);

          return summarizePortfolioProjectAssessment({
            project,
            staleAfterDays: args.stale_after_days,
            openMergeRequests: mergeRequestsResponse.data,
            openIssues: issuesResponse.data,
            pipelineSignals: pipelinesResponse.data
          });
        })
      );

      const result = summarizePortfolioDeliveryOverviewAssessment({
        scopeType: args.scope_type,
        scope,
        staleAfterDays: args.stale_after_days,
        projectSummaries
      });

      return presentOutput(args.output_format, result, formatPortfolioDeliveryOverviewMarkdown);
    }
  });

  registerTool(deps, {
    name: "gitlab_summarize_recent_activity",
    title: "Summarize Recent Activity",
    description: "Summarize recent events, issues, merge requests, and pipelines for a project.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      days: z.number().int().positive().max(90).optional().default(7)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const after = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

      const [events, issues, mergeRequests, pipelines] = await Promise.all([
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/events`, {
          query: { after, per_page: 50 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
          query: { updated_after: after, per_page: 20 }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
          query: { updated_after: after, per_page: 20, scope: "all", state: "all" }
        }),
        client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/pipelines`, {
          query: { updated_after: after, per_page: 20 }
        })
      ]);

      return {
        window_days: args.days,
        event_count: events.data.length,
        issue_count: issues.data.length,
        merge_request_count: mergeRequests.data.length,
        pipeline_count: pipelines.data.length,
        highlights: {
          events: events.data.slice(0, 10),
          issues: issues.data.slice(0, 10),
          merge_requests: mergeRequests.data.slice(0, 10),
          pipelines: pipelines.data.slice(0, 10)
        }
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_unassigned_issues",
    title: "Find Unassigned Issues",
    description: "Find opened issues in a project with no assignee.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      per_page: z.number().int().positive().max(100).optional().default(100)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/issues`,
        {
          query: {
            state: "opened",
            assignee_id: "None",
            per_page: args.per_page
          }
        }
      );

      return {
        items: response.data,
        pagination: response.pagination
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_find_security_related_issues",
    title: "Find Security Related Issues",
    description:
      "Find potentially security-related issues using simple keyword search heuristics over titles and descriptions.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      keywords: z.array(z.string().trim().min(1)).optional()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const keywords = args.keywords ?? ["security", "vulnerability", "cve", "secret", "auth"];

      const results = await Promise.all(
        keywords.map((keyword) =>
          client.getJson<JsonMap[]>(`/projects/${encodeURIComponent(args.project_id)}/issues`, {
            query: {
              search: keyword,
              in: "title,description",
              scope: "all",
              per_page: 50
            }
          })
        )
      );

      const deduped = new Map<string, JsonMap>();
      for (const response of results) {
        for (const issue of response.data) {
          deduped.set(issueKey(issue), issue);
        }
      }

      return {
        keywords,
        items: Array.from(deduped.values())
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_trace_issue_to_merge_requests",
    title: "Trace Issue To Merge Requests",
    description: "List merge requests that close a specific issue when merged.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      issue_iid: z.number().int().positive()
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const response = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/issues/${args.issue_iid}/closed_by`
      );

      return {
        items: response.data
      };
    }
  });

  registerTool(deps, {
    name: "gitlab_trace_merge_request_to_pipeline_failures",
    title: "Trace Merge Request To Pipeline Failures",
    description:
      "Trace a merge request to its recent pipelines and failed jobs, including short trace tails for failed jobs.",
    safety: "read-only",
    inputSchema: {
      project_id: z.string().trim().min(1),
      merge_request_iid: z.number().int().positive(),
      pipeline_limit: z.number().int().positive().max(10).optional().default(5),
      trace_tail_lines: z.number().int().positive().max(100).optional().default(20)
    },
    handler: async (args, { client, requireProject }) => {
      await requireProject(args.project_id);
      const pipelinesResponse = await client.getJson<JsonMap[]>(
        `/projects/${encodeURIComponent(args.project_id)}/merge_requests/${args.merge_request_iid}/pipelines`
      );

      const selectedPipelines = pipelinesResponse.data.slice(0, args.pipeline_limit);
      const pipelineFailures = await Promise.all(
        selectedPipelines.map(async (pipeline) => {
          const pipelineId = typeof pipeline.id === "number" ? pipeline.id : null;
          if (!pipelineId) {
            return {
              pipeline,
              failed_jobs: []
            };
          }

          const failedJobs = await getFailedJobs(client, args.project_id, pipelineId);
          const failedJobsWithTrace = await Promise.all(
            failedJobs.slice(0, 3).map(async (job) => {
              const jobId = typeof job.id === "number" ? job.id : null;

              return {
                ...job,
                trace_tail:
                  jobId === null
                    ? ""
                    : await getTraceTail(client, args.project_id, jobId, args.trace_tail_lines)
              };
            })
          );

          return {
            pipeline,
            failed_jobs: failedJobsWithTrace
          };
        })
      );

      return {
        merge_request_iid: args.merge_request_iid,
        pipeline_failures: pipelineFailures,
        content_is_untrusted: true
      };
    }
  });
}

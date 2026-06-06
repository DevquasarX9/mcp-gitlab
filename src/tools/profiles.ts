import type { ToolProfile } from "../config.js";
import type { SafetyLevel } from "../security/guards.js";

export type ToolCategory =
  | "instance"
  | "projects"
  | "repository"
  | "issues"
  | "merge-requests"
  | "pipelines"
  | "releases"
  | "groups"
  | "governance"
  | "intelligence";

interface ToolProfileMetadata {
  readonly name: string;
  readonly safety: SafetyLevel;
  readonly category?: ToolCategory;
  readonly profiles?: readonly ToolProfile[];
}

export interface ToolRegistrationDecision {
  readonly register: boolean;
  readonly reason?: string;
}

const toolProfileRules: Record<Exclude<ToolProfile, "full">, ReadonlySet<ToolCategory>> = {
  readonly: new Set([
    "instance",
    "projects",
    "repository",
    "issues",
    "merge-requests",
    "pipelines",
    "releases",
    "groups",
    "governance",
    "intelligence"
  ]),
  core: new Set([
    "instance",
    "projects",
    "repository",
    "issues",
    "merge-requests",
    "pipelines"
  ]),
  "mr-review": new Set([
    "instance",
    "projects",
    "repository",
    "merge-requests",
    "pipelines",
    "governance",
    "intelligence"
  ]),
  "ci-triage": new Set([
    "instance",
    "projects",
    "repository",
    "merge-requests",
    "pipelines",
    "intelligence"
  ]),
  delivery: new Set([
    "instance",
    "projects",
    "issues",
    "merge-requests",
    "pipelines",
    "groups",
    "intelligence"
  ]),
  release: new Set([
    "instance",
    "projects",
    "repository",
    "merge-requests",
    "pipelines",
    "releases",
    "governance",
    "intelligence"
  ]),
  governance: new Set([
    "instance",
    "projects",
    "groups",
    "governance"
  ]),
  "maintainer-write": new Set([
    "instance",
    "projects",
    "repository",
    "issues",
    "merge-requests",
    "pipelines",
    "releases",
    "groups",
    "governance",
    "intelligence"
  ])
};

export function shouldRegisterTool(
  metadata: ToolProfileMetadata,
  config: {
    readonly toolProfile: ToolProfile;
    readonly enabledTools: readonly string[];
    readonly disabledTools: readonly string[];
    readonly exposeDisabledWriteTools: boolean;
    readonly enableWriteTools: boolean;
    readonly enableDestructiveTools: boolean;
  }
): ToolRegistrationDecision {
  const disabledTools = new Set(config.disabledTools);
  if (disabledTools.has(metadata.name)) {
    return { register: false, reason: "explicitly-disabled" };
  }

  const enabledTools = new Set(config.enabledTools);
  if (enabledTools.size > 0 && !enabledTools.has(metadata.name)) {
    return { register: false, reason: "not-explicitly-enabled" };
  }

  if (!config.exposeDisabledWriteTools) {
    if (metadata.safety === "safe-write" && !config.enableWriteTools) {
      return { register: false, reason: "write-tools-disabled" };
    }

    if (metadata.safety === "destructive" && (!config.enableWriteTools || !config.enableDestructiveTools)) {
      return { register: false, reason: "destructive-tools-disabled" };
    }
  }

  if (config.toolProfile === "full") {
    return { register: true };
  }

  if (metadata.profiles?.includes(config.toolProfile)) {
    return { register: true };
  }

  const category = metadata.category ?? inferToolCategory(metadata.name);
  const allowedCategories = toolProfileRules[config.toolProfile];

  if (!allowedCategories.has(category)) {
    return { register: false, reason: "profile-category-filtered" };
  }

  if (config.toolProfile === "readonly" && metadata.safety !== "read-only") {
    return { register: false, reason: "readonly-profile" };
  }

  if (config.toolProfile !== "maintainer-write" && metadata.safety !== "read-only") {
    return { register: false, reason: "profile-write-filtered" };
  }

  return { register: true };
}

export function inferToolCategory(toolName: string): ToolCategory {
  if (toolName.includes("_pipeline") || toolName.includes("_job") || toolName.includes("_ci_")) {
    return "pipelines";
  }

  if (toolName.includes("_merge_request")) {
    return "merge-requests";
  }

  if (toolName.includes("_issue")) {
    return "issues";
  }

  if (
    toolName.includes("_release") ||
    toolName.includes("_package") ||
    toolName.includes("_tag")
  ) {
    return "releases";
  }

  if (
    toolName.includes("_repository") ||
    toolName.includes("_file") ||
    toolName.includes("_commit") ||
    toolName.includes("_branch") ||
    toolName.includes("_code") ||
    toolName.includes("_directory")
  ) {
    return "repository";
  }

  if (toolName.includes("_group") || toolName.includes("_portfolio") || toolName.includes("_team_delivery")) {
    return "groups";
  }

  if (
    toolName.includes("_approval") ||
    toolName.includes("_protected") ||
    toolName.includes("_protection") ||
    toolName.includes("_write_risk")
  ) {
    return "governance";
  }

  if (
    toolName.includes("_dashboard") ||
    toolName.includes("_status") ||
    toolName.includes("_stale") ||
    toolName.includes("_blocked") ||
    toolName.includes("_flaky") ||
    toolName.includes("_readiness") ||
    toolName.includes("_digest") ||
    toolName.includes("_overview") ||
    toolName.includes("_summarize") ||
    toolName.includes("_trace") ||
    toolName.includes("_risk")
  ) {
    return "intelligence";
  }

  if (toolName.includes("_project")) {
    return "projects";
  }

  return "instance";
}

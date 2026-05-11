import { describe, expect, it } from "vitest";

import {
  categorizeReleaseCommits,
  summarizeCommitRangeAssessment
} from "../src/tools/intelligence.js";
import { formatCommitRangeSummaryMarkdown } from "../src/tools/output.js";

describe("summarizeCommitRangeAssessment", () => {
  it("marks the range as elevated when broad and operationally sensitive files changed", () => {
    const commits = [
      { title: "feat: add deployment automation" },
      { title: "fix: patch worker retry" },
      { title: "chore: update dependencies" }
    ];
    const result = summarizeCommitRangeAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      fromRef: "v1.2.0",
      toRef: "main",
      commits,
      diffs: [
        { new_path: ".gitlab-ci.yml" },
        { new_path: "deploy/helm/chart.yaml" },
        { new_path: "migrations/20260511_add_index.sql" },
        { new_path: "package-lock.json" },
        { new_path: "src/auth/guards.ts" },
        { new_path: "src/services/orders.ts" }
      ],
      categories: categorizeReleaseCommits(commits)
    });

    expect(result).toMatchObject({
      change_risk: "elevated"
    });
    expect(result.warnings).toContain("CI or automation files were touched in 1 changed paths.");
    expect(result.warnings).toContain("Dependency definitions or lockfiles were touched in 1 changed paths.");
    expect(result.warnings).toContain("Schema or migration-related files were touched in 1 changed paths.");
    expect(result.next_actions).toContain(
      "Double-check CI and automation changes before relying on the range summary alone."
    );
  });

  it("marks the range as routine when changes are focused", () => {
    const commits = [{ title: "fix: patch retry loop" }];
    const result = summarizeCommitRangeAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      fromRef: "abc123",
      toRef: "def456",
      commits,
      diffs: [
        { new_path: "src/services/retry.ts" },
        { new_path: "src/services/retry.test.ts" }
      ],
      categories: categorizeReleaseCommits(commits)
    });

    expect(result).toMatchObject({
      change_risk: "routine"
    });
    expect(result.warnings).toEqual([]);
    expect(result.next_actions).toContain(
      "Review the top changed directories and sampled commits for correctness and rollout context."
    );
  });
});

describe("formatCommitRangeSummaryMarkdown", () => {
  it("renders a shareable commit-range summary", () => {
    const markdown = formatCommitRangeSummaryMarkdown({
      project: {
        path_with_namespace: "group/api"
      },
      from_ref: "v1.2.0",
      to_ref: "main",
      change_risk: "watch",
      summary: "This commit range looks understandable, but it includes some paths or breadth that deserve extra review.",
      warnings: ["CI or automation files were touched in 1 changed paths."],
      next_actions: ["Double-check CI and automation changes before relying on the range summary alone."],
      signals: {
        commit_count: 3,
        changed_file_count: 6,
        changed_directory_count: 4,
        feature_commit_count: 1,
        fix_commit_count: 1,
        chore_commit_count: 1,
        ci_touch_count: 1,
        dependency_touch_count: 1,
        data_model_touch_count: 1
      },
      highlights: {
        top_directories: [
          {
            path: "src",
            changed_file_count: 2
          }
        ],
        notable_files: [
          {
            path: ".gitlab-ci.yml",
            reason: "Touches CI or automation configuration."
          }
        ],
        sampled_commits: [
          {
            short_id: "abc123",
            title: "feat: add deployment automation"
          }
        ]
      }
    });

    expect(markdown).toContain("# Commit Range Summary: group/api");
    expect(markdown).toContain("Change risk: watch");
    expect(markdown).toContain("src: 2 changed files");
    expect(markdown).toContain(".gitlab-ci.yml - Touches CI or automation configuration.");
    expect(markdown).toContain("abc123 feat: add deployment automation");
  });
});

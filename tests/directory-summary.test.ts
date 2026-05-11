import { describe, expect, it } from "vitest";

import { summarizeDirectoryAssessment } from "../src/tools/intelligence.js";
import { formatDirectorySummaryMarkdown } from "../src/tools/output.js";

describe("summarizeDirectoryAssessment", () => {
  it("identifies an application-oriented directory with key files and subdirectories", () => {
    const result = summarizeDirectoryAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      path: "src",
      ref: "main",
      recursive: true,
      items: [
        { path: "src/index.ts", type: "blob" },
        { path: "src/app.ts", type: "blob" },
        { path: "src/config.ts", type: "blob" },
        { path: "src/services", type: "tree" },
        { path: "src/services/orders.ts", type: "blob" },
        { path: "src/services/retries.ts", type: "blob" },
        { path: "src/docs", type: "tree" },
        { path: "src/docs/README.md", type: "blob" }
      ]
    });

    expect(result).toMatchObject({
      directory_profile: "application"
    });
    expect(result.highlights).toMatchObject({
      key_files: expect.arrayContaining([
        expect.objectContaining({
          path: "src/index.ts"
        }),
        expect.objectContaining({
          path: "src/docs/README.md"
        })
      ])
    });
    expect(result.next_actions).toContain("Start with the detected key files, then inspect the top subdirectories.");
  });

  it("identifies a documentation-heavy directory", () => {
    const result = summarizeDirectoryAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      path: "docs",
      ref: "main",
      recursive: true,
      items: [
        { path: "docs/README.md", type: "blob" },
        { path: "docs/architecture.md", type: "blob" },
        { path: "docs/runbooks", type: "tree" },
        { path: "docs/runbooks/deploy.md", type: "blob" }
      ]
    });

    expect(result).toMatchObject({
      directory_profile: "documentation"
    });
  });

  it("adds a warning when no obvious key files exist", () => {
    const result = summarizeDirectoryAssessment({
      project: {
        id: 1,
        path_with_namespace: "group/api",
        default_branch: "main"
      },
      path: "vendor/cache",
      ref: "main",
      recursive: true,
      items: [
        { path: "vendor/cache/a.tmp", type: "blob" },
        { path: "vendor/cache/b.tmp", type: "blob" }
      ]
    });

    expect(result.warnings).toContain(
      "No obvious manifest, README, or entry file was detected in the sampled directory."
    );
  });
});

describe("formatDirectorySummaryMarkdown", () => {
  it("renders a shareable directory summary", () => {
    const markdown = formatDirectorySummaryMarkdown({
      project: {
        path_with_namespace: "group/api"
      },
      path: "src",
      ref: "main",
      directory_profile: "application",
      summary: "This directory looks primarily application-oriented based on the file types and entry-file heuristics in the sampled tree.",
      warnings: [],
      next_actions: ["Start with the detected key files, then inspect the top subdirectories."],
      signals: {
        total_entry_count: 8,
        file_count: 6,
        directory_count: 2,
        max_depth: 2
      },
      highlights: {
        key_files: [
          {
            path: "src/index.ts",
            reason: "Likely executable or application entry file."
          }
        ],
        top_subdirectories: [
          {
            path: "services",
            changed_file_count: 1
          }
        ],
        top_file_types: [
          {
            extension: ".ts",
            file_count: 4
          }
        ]
      }
    });

    expect(markdown).toContain("# Directory Summary: group/api");
    expect(markdown).toContain("Directory profile: application");
    expect(markdown).toContain("src/index.ts - Likely executable or application entry file.");
    expect(markdown).toContain("services: 1 changed files");
    expect(markdown).toContain(".ts: 4 files");
  });
});

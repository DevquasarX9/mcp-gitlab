import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/index.js";
import type { AppConfig } from "../src/config.js";

const testConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  toolProfile: "readonly",
  enabledTools: [],
  disabledTools: [],
  exposeDisabledWriteTools: false,
  mcpTransport: "stdio",
  mcpHttpHost: "127.0.0.1",
  mcpHttpPort: 3333,
  mcpHttpPath: "/mcp",
  mcpHttpAllowedOrigins: [],
  mcpHttpAllowedHosts: ["localhost", "127.0.0.1", "[::1]"],
  mcpHttpAllowNonLocalhost: false,
  enableWriteTools: false,
  enableDestructiveTools: false,
  enableDryRun: false,
  projectAliases: {},
  groupAliases: {},
  projectAllowlist: [],
  groupAllowlist: [],
  projectDenylist: [],
  maxFileSizeBytes: 1_048_576,
  maxDiffSizeBytes: 2_097_152,
  maxApiResponseBytes: 4_194_304,
  httpTimeoutMs: 30_000,
  gitlabUserAgent: "gitlab-mcp-server",
  logLevel: "info",
  exposeSecretVariableValues: false
};

describe("workflow prompts", () => {
  it("registers the guided workflow prompts for MCP clients", async () => {
    const { server } = createServer(testConfig);
    const client = new Client({
      name: "prompt-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.listPrompts();
    const names = result.prompts.map((prompt) => prompt.name).sort();

    expect(names).toEqual([
      "gitlab_assess_project_write_safety_workflow",
      "gitlab_explain_failed_pipeline_workflow",
      "gitlab_flaky_ci_triage_workflow",
      "gitlab_generate_weekly_delivery_summary_workflow",
      "gitlab_portfolio_delivery_overview_workflow",
      "gitlab_release_readiness_check_workflow",
      "gitlab_review_merge_request_workflow",
      "gitlab_stale_merge_request_cleanup_workflow",
      "gitlab_summarize_commit_range_workflow",
      "gitlab_summarize_directory_workflow",
      "gitlab_summarize_project_status_workflow",
      "gitlab_team_delivery_digest_workflow"
    ]);

    await Promise.all([client.close(), server.close()]);
  });

  it("returns prompt content that points the model at the existing tool surface", async () => {
    const { server } = createServer(testConfig);
    const client = new Client({
      name: "prompt-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const prompt = await client.getPrompt({
      name: "gitlab_review_merge_request_workflow",
      arguments: {
        project_id: "group/project",
        merge_request_iid: "42",
        focus: "correctness and rollout risk"
      }
    });

    expect(prompt.description).toBe("Objective merge request review workflow");
    expect(prompt.messages).toHaveLength(1);
    const firstMessage = prompt.messages[0];

    expect(firstMessage).toBeDefined();
    expect(firstMessage).toMatchObject({
      role: "user",
      content: {
        type: "text"
      }
    });

    if (firstMessage === undefined) {
      throw new Error("Expected prompt to return a message.");
    }

    const text = firstMessage.content.type === "text" ? firstMessage.content.text : "";

    expect(text).toContain('Review GitLab merge request !42 in project "group/project" objectively.');
    expect(text).toContain("Recommended tool profile: mr-review.");
    expect(text).toContain("Prefer structured outputs with summary, status or risk_level, confidence, blockers, warnings, next_actions, and source_links.");
    expect(text).toContain("gitlab_get_merge_request_review_state");
    expect(text).toContain("gitlab_review_merge_request_risks");
    expect(text).toContain("gitlab_trace_merge_request_to_pipeline_failures");

    await Promise.all([client.close(), server.close()]);
  });

  it("registers hero workflow prompts with task-specific tool guidance", async () => {
    const { server } = createServer(testConfig);
    const client = new Client({
      name: "prompt-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const prompt = await client.getPrompt({
      name: "gitlab_flaky_ci_triage_workflow",
      arguments: {
        project_id: "group/project",
        ref: "main"
      }
    });

    expect(prompt.description).toBe("Flaky CI triage workflow");
    expect(prompt.messages).toHaveLength(1);

    const firstMessage = prompt.messages[0];
    if (firstMessage === undefined || firstMessage.content.type !== "text") {
      throw new Error("Expected flaky CI prompt to return a text message.");
    }

    expect(firstMessage.content.text).toContain('Investigate flaky CI behavior in project "group/project".');
    expect(firstMessage.content.text).toContain("Recommended tool profile: ci-triage.");
    expect(firstMessage.content.text).toContain("Use output_format=\"markdown\" only when the result is meant to be pasted into chat");
    expect(firstMessage.content.text).toContain("gitlab_find_flaky_jobs");
    expect(firstMessage.content.text).toContain("gitlab_compare_pipeline_runs");
    expect(firstMessage.content.text).toContain("gitlab_trace_job_to_commit_and_merge_request");

    await Promise.all([client.close(), server.close()]);
  });

  it("registers the portfolio workflow prompt with cross-project tool guidance", async () => {
    const { server } = createServer(testConfig);
    const client = new Client({
      name: "prompt-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const prompt = await client.getPrompt({
      name: "gitlab_portfolio_delivery_overview_workflow",
      arguments: {
        group_id: "group/platform",
        project_limit: "5"
      }
    });

    expect(prompt.description).toBe("Portfolio delivery overview workflow");
    expect(prompt.messages).toHaveLength(1);

    const firstMessage = prompt.messages[0];
    if (firstMessage === undefined || firstMessage.content.type !== "text") {
      throw new Error("Expected portfolio overview prompt to return a text message.");
    }

    expect(firstMessage.content.text).toContain('Assess cross-project delivery health for group "group/platform".');
    expect(firstMessage.content.text).toContain("Recommended tool profile: delivery.");
    expect(firstMessage.content.text).toContain("gitlab_portfolio_delivery_overview");
    expect(firstMessage.content.text).toContain("gitlab_get_group_delivery_overview");
    expect(firstMessage.content.text).toContain("chat-ready portfolio summary");

    await Promise.all([client.close(), server.close()]);
  });

  it("registers the commit-range workflow prompt with repository-intelligence guidance", async () => {
    const { server } = createServer(testConfig);
    const client = new Client({
      name: "prompt-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const prompt = await client.getPrompt({
      name: "gitlab_summarize_commit_range_workflow",
      arguments: {
        project_id: "group/project",
        from_ref: "v1.2.0",
        to_ref: "main"
      }
    });

    expect(prompt.description).toBe("Commit range summary workflow");
    expect(prompt.messages).toHaveLength(1);

    const firstMessage = prompt.messages[0];
    if (firstMessage === undefined || firstMessage.content.type !== "text") {
      throw new Error("Expected commit-range prompt to return a text message.");
    }

    expect(firstMessage.content.text).toContain('Summarize what changed in project "group/project" from "v1.2.0" to "main".');
    expect(firstMessage.content.text).toContain("gitlab_summarize_commit_range");
    expect(firstMessage.content.text).toContain("gitlab_compare_refs");
    expect(firstMessage.content.text).toContain("risky paths");

    await Promise.all([client.close(), server.close()]);
  });

  it("registers the directory workflow prompt with repository-tree guidance", async () => {
    const { server } = createServer(testConfig);
    const client = new Client({
      name: "prompt-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const prompt = await client.getPrompt({
      name: "gitlab_summarize_directory_workflow",
      arguments: {
        project_id: "group/project",
        path: "src/services",
        ref: "main"
      }
    });

    expect(prompt.description).toBe("Directory summary workflow");
    expect(prompt.messages).toHaveLength(1);

    const firstMessage = prompt.messages[0];
    if (firstMessage === undefined || firstMessage.content.type !== "text") {
      throw new Error("Expected directory-summary prompt to return a text message.");
    }

    expect(firstMessage.content.text).toContain('Summarize directory "src/services" in project "group/project" at ref "main".');
    expect(firstMessage.content.text).toContain("gitlab_summarize_directory");
    expect(firstMessage.content.text).toContain("gitlab_list_repository_tree");
    expect(firstMessage.content.text).toContain("best next files to inspect");

    await Promise.all([client.close(), server.close()]);
  });
});

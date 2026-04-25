import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, type AppConfig } from "./config.js";
import { GitLabClient } from "./gitlab/client.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerGovernanceTools } from "./tools/governance.js";
import { registerInstanceTools } from "./tools/instance.js";
import { registerIntelligenceTools } from "./tools/intelligence.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerMergeRequestTools } from "./tools/mergeRequests.js";
import { registerPipelineTools } from "./tools/pipelines.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerProjectDashboardTools } from "./tools/projectDashboard.js";
import { registerReleaseTools } from "./tools/releases.js";
import { registerRepositoryTools } from "./tools/repository.js";
import { registerReviewStateTools } from "./tools/reviewState.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version?: string };

export function createServer(config: AppConfig = loadConfig()): {
  server: McpServer;
  client: GitLabClient;
} {
  const server = new McpServer({
    name: "gitlab-mcp-server",
    version: packageJson.version ?? "0.1.0"
  });

  const client = new GitLabClient(config);
  const deps = { server, client, config };

  registerInstanceTools(deps);
  registerProjectTools(deps);
  registerProjectDashboardTools(deps);
  registerRepositoryTools(deps);
  registerIssueTools(deps);
  registerMergeRequestTools(deps);
  registerReviewStateTools(deps);
  registerPipelineTools(deps);
  registerReleaseTools(deps);
  registerGroupTools(deps);
  registerGovernanceTools(deps);
  registerIntelligenceTools(deps);

  return { server, client };
}

export async function runCli(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

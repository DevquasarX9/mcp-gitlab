import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";

import type { AppConfig } from "../src/config.js";
import { createServer } from "../src/index.js";

const originalDispatcher = getGlobalDispatcher();

const baseConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.example/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  toolProfile: "full",
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
  enableWriteTools: true,
  enableDestructiveTools: false,
  enableDryRun: true,
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
  logLevel: "error",
  exposeSecretVariableValues: false
};

const noteTools = [
  {
    name: "gitlab_add_issue_comment",
    args: {
      project_id: "group/project",
      issue_iid: 17,
      body: "Visible issue note."
    },
    endpoint: "/projects/group/project/issues/17/notes"
  },
  {
    name: "gitlab_add_merge_request_comment",
    args: {
      project_id: "group/project",
      merge_request_iid: 17,
      body: "Visible MR note."
    },
    endpoint: "/projects/group/project/merge_requests/17/notes"
  }
];

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

describe("internal note access guards", () => {
  it.each(noteTools)("allows guest access for regular $name dry runs", async ({ name, args, endpoint }) => {
    const result = await callNoteToolWithAccessLevel(name, args, 10);
    const structuredContent = result.structuredContent as {
      ok: boolean;
      data: Record<string, unknown>;
    };

    expect(structuredContent.ok).toBe(true);
    expect(structuredContent.data).toMatchObject({
      dry_run: true,
      endpoint,
      body: {
        body: args.body
      }
    });
  });

  it.each(noteTools)("blocks guest access for internal $name dry runs", async ({ name, args }) => {
    const result = await callNoteToolWithAccessLevel(name, { ...args, internal: true }, 10);
    const structuredContent = result.structuredContent as {
      ok: boolean;
      error: string;
    };

    expect(structuredContent.ok).toBe(false);
    expect(structuredContent.error).toMatch(/Reporter-level access/);
  });

  it.each(noteTools)("allows reporter access for internal $name dry runs", async ({ name, args, endpoint }) => {
    const result = await callNoteToolWithAccessLevel(name, { ...args, internal: true }, 20);
    const structuredContent = result.structuredContent as {
      ok: boolean;
      data: Record<string, unknown>;
    };

    expect(structuredContent.ok).toBe(true);
    expect(structuredContent.data).toMatchObject({
      dry_run: true,
      endpoint,
      body: {
        body: args.body,
        internal: true
      }
    });
  });
});

async function callNoteToolWithAccessLevel(
  name: string,
  args: Record<string, unknown>,
  accessLevel: number
) {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const gitlab = mockAgent.get("https://gitlab.example");
  gitlab
    .intercept({
      method: "GET",
      path: "/api/v4/projects/group%2Fproject"
    })
    .reply(200, {
      id: 1,
      path_with_namespace: "group/project",
      permissions: {
        project_access: {
          access_level: accessLevel
        }
      }
    }, {
      headers: {
        "content-type": "application/json"
      }
    });

  const { server } = createServer(baseConfig);
  const client = new Client({
    name: "internal-note-test-client",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    return await client.callTool({
      name,
      arguments: args
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
    await mockAgent.close();
  }
}

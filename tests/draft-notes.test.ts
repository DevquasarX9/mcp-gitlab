import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";

import type { AppConfig } from "../src/config.js";
import { createServer } from "../src/index.js";
import {
  buildDraftNoteCreateBody,
  buildDraftNoteUpdateBody,
  normalizeDraftNoteDeleteResponse
} from "../src/tools/mergeRequests.js";

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

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

describe("draft note helpers", () => {
  it("passes raw draft-note positions through unchanged", () => {
    const position = {
      base_sha: "base",
      head_sha: "head",
      start_sha: "start",
      new_path: "src/App.php",
      old_path: "src/App.php",
      position_type: "text",
      new_line: 42,
      line_range: {
        start: { line_code: "abc_40_42", type: "new", new_line: 40 },
        end: { line_code: "abc_40_42", type: "new", new_line: 42 }
      }
    };

    const body = buildDraftNoteCreateBody({
      note: "Please tighten this branch.",
      position
    });

    expect(body).toEqual({
      note: "Please tighten this branch.",
      position
    });
    expect(body.position).toBe(position);
  });

  it("rejects empty draft-note updates", () => {
    expect(() => buildDraftNoteUpdateBody({})).toThrow(/Draft note updates require/);
  });

  it("normalizes empty draft-note delete responses", () => {
    expect(
      normalizeDraftNoteDeleteResponse({
        responseData: "",
        projectId: "group/project",
        mergeRequestIid: 17,
        draftNoteId: 23
      })
    ).toEqual({
      deleted: true,
      project_id: "group/project",
      merge_request_iid: 17,
      draft_note_id: 23
    });
  });
});

describe("draft note dry runs", () => {
  it.each([
    {
      name: "gitlab_create_draft_note",
      args: {
        project_id: "group/project",
        merge_request_iid: 17,
        note: "Review this later.",
        position: {
          base_sha: "base",
          head_sha: "head",
          start_sha: "start",
          position_type: "text",
          new_path: "src/App.php",
          old_path: "src/App.php",
          new_line: 42
        }
      },
      expected: {
        endpoint: "/projects/group/project/merge_requests/17/draft_notes",
        body: {
          note: "Review this later.",
          position: {
            base_sha: "base",
            head_sha: "head",
            start_sha: "start",
            position_type: "text",
            new_path: "src/App.php",
            old_path: "src/App.php",
            new_line: 42
          }
        }
      }
    },
    {
      name: "gitlab_update_draft_note",
      args: {
        project_id: "group/project",
        merge_request_iid: 17,
        draft_note_id: 23,
        note: "Updated draft."
      },
      expected: {
        endpoint: "/projects/group/project/merge_requests/17/draft_notes/23",
        body: {
          note: "Updated draft."
        }
      }
    },
    {
      name: "gitlab_delete_draft_note",
      args: {
        project_id: "group/project",
        merge_request_iid: 17,
        draft_note_id: 23
      },
      expected: {
        endpoint: "/projects/group/project/merge_requests/17/draft_notes/23"
      }
    },
    {
      name: "gitlab_publish_draft_note",
      args: {
        project_id: "group/project",
        merge_request_iid: 17,
        draft_note_id: 23
      },
      expected: {
        endpoint: "/projects/group/project/merge_requests/17/draft_notes/23/publish"
      }
    },
    {
      name: "gitlab_bulk_publish_draft_notes",
      args: {
        project_id: "group/project",
        merge_request_iid: 17
      },
      expected: {
        endpoint: "/projects/group/project/merge_requests/17/draft_notes/bulk_publish"
      }
    }
  ])("returns dry-run output for $name", async ({ name, args, expected }) => {
    const result = await callDraftNoteTool(name, args);
    const structuredContent = result.structuredContent as {
      ok: boolean;
      data: Record<string, unknown>;
    };

    expect(structuredContent.ok).toBe(true);
    expect(structuredContent.data).toMatchObject({
      dry_run: true,
      ...expected
    });
  });
});

async function callDraftNoteTool(name: string, args: Record<string, unknown>) {
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
          access_level: 10
        }
      }
    }, {
      headers: {
        "content-type": "application/json"
      }
    });

  const { server } = createServer(baseConfig);
  const client = new Client({
    name: "draft-note-test-client",
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

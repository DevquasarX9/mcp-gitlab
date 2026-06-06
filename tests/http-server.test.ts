import { describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { AppConfig } from "../src/config.js";
import {
  assertHttpServerSafety,
  createHttpApp,
  isAllowedHttpOrigin,
  isAuthorizedHttpRequest,
  isLocalHttpHost
} from "../src/httpServer.js";

const baseConfig: AppConfig = {
  gitlabBaseUrl: "https://gitlab.com/api/v4",
  gitlabToken: "test-token",
  tokenHeaderMode: "bearer",
  toolProfile: "readonly",
  enabledTools: [],
  disabledTools: [],
  exposeDisabledWriteTools: false,
  mcpTransport: "http",
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
  logLevel: "error",
  exposeSecretVariableValues: false
};

function isListenPermissionError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EPERM";
}

function parseMcpHttpJson(body: string): unknown {
  const trimmed = body.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const dataLine = trimmed.split("\n").find((line) => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error("MCP HTTP response did not include a JSON or SSE data payload.");
  }

  return JSON.parse(dataLine.slice("data: ".length));
}

async function listenOnLocalhost(app: ReturnType<typeof createHttpApp>): Promise<Server | null> {
  try {
    return await new Promise<Server>((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(server);
      });
    });
  } catch (error) {
    if (isListenPermissionError(error)) {
      return null;
    }

    throw error;
  }
}

async function closeListener(listener: Server): Promise<void> {
  if (!listener.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("HTTP transport guards", () => {
  it("recognizes local-only bind hosts", () => {
    expect(isLocalHttpHost("127.0.0.1")).toBe(true);
    expect(isLocalHttpHost("localhost")).toBe(true);
    expect(isLocalHttpHost("[::1]")).toBe(true);
    expect(isLocalHttpHost("0.0.0.0")).toBe(false);
  });

  it("allows the default local HTTP server settings", () => {
    expect(() => assertHttpServerSafety(baseConfig)).not.toThrow();
  });

  it("rejects non-local binds without both the override and bearer token", () => {
    expect(() =>
      assertHttpServerSafety({
        ...baseConfig,
        mcpHttpHost: "0.0.0.0"
      })
    ).toThrow(/Refusing to bind/);

    expect(() =>
      assertHttpServerSafety({
        ...baseConfig,
        mcpHttpHost: "0.0.0.0",
        mcpHttpAllowNonLocalhost: true
      })
    ).toThrow(/Refusing to bind/);
  });

  it("permits non-local binds only with the explicit override and bearer token", () => {
    expect(() =>
      assertHttpServerSafety({
        ...baseConfig,
        mcpHttpHost: "0.0.0.0",
        mcpHttpAuthToken: "secret",
        mcpHttpAllowNonLocalhost: true
      })
    ).not.toThrow();
  });

  it("allows missing, local, and configured origins while rejecting unknown remote origins", () => {
    const config: AppConfig = {
      ...baseConfig,
      mcpHttpAllowedOrigins: ["https://trusted.example.test"]
    };

    expect(isAllowedHttpOrigin(undefined, config)).toBe(true);
    expect(isAllowedHttpOrigin("http://localhost:3000", config)).toBe(true);
    expect(isAllowedHttpOrigin("https://trusted.example.test", config)).toBe(true);
    expect(isAllowedHttpOrigin("https://untrusted.example.test", config)).toBe(false);
    expect(isAllowedHttpOrigin("not a url", config)).toBe(false);
  });

  it("enforces bearer auth only when an HTTP auth token is configured", () => {
    expect(isAuthorizedHttpRequest(undefined, baseConfig)).toBe(true);

    const config: AppConfig = {
      ...baseConfig,
      mcpHttpAuthToken: "secret"
    };

    expect(isAuthorizedHttpRequest(undefined, config)).toBe(false);
    expect(isAuthorizedHttpRequest("Basic secret", config)).toBe(false);
    expect(isAuthorizedHttpRequest("Bearer wrong", config)).toBe(false);
    expect(isAuthorizedHttpRequest("Bearer secret", config)).toBe(true);
  });

  it("handles CORS preflight before bearer auth", async () => {
    const config: AppConfig = {
      ...baseConfig,
      mcpHttpAuthToken: "secret",
      mcpHttpAllowedOrigins: ["https://trusted.example.test"]
    };
    const app = createHttpApp(config);
    const listener = await listenOnLocalhost(app);

    if (!listener) {
      return;
    }

    try {
      const address = listener.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}${baseConfig.mcpHttpPath}`, {
        method: "OPTIONS",
        headers: {
          "Origin": "https://trusted.example.test",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Authorization, Content-Type"
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://trusted.example.test");
      expect(response.headers.get("access-control-allow-methods")).toContain("POST");
      expect(response.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
    } finally {
      await closeListener(listener);
    }
  });

  it("handles an MCP initialize request over Streamable HTTP", async () => {
    const app = createHttpApp(baseConfig);
    const listener = await listenOnLocalhost(app);

    if (!listener) {
      return;
    }

    try {
      const address = listener.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}${baseConfig.mcpHttpPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: {
              name: "http-test-client",
              version: "1.0.0"
            }
          }
        })
      });

      const responseBody = await response.text();
      const payload = parseMcpHttpJson(responseBody) as {
        readonly jsonrpc: string;
        readonly id: number;
        readonly result?: {
          readonly serverInfo?: {
            readonly name?: string;
          };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.jsonrpc).toBe("2.0");
      expect(payload.id).toBe(1);
      expect(payload.result?.serverInfo?.name).toBe("gitlab-mcp-server");
    } finally {
      await closeListener(listener);
    }
  });
});

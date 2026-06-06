import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { loadConfig, type AppConfig } from "./config.js";
import { createServer } from "./index.js";

type HttpRequest = IncomingMessage & {
  readonly body?: unknown;
};

type JsonHttpResponse = ServerResponse & {
  readonly headersSent: boolean;
  status(code: number): JsonHttpResponse;
  json(body: unknown): void;
};

type NextFunction = () => void;

const corsAllowedMethods = "POST, GET, DELETE, OPTIONS";
const defaultCorsAllowedHeaders = "Authorization, Content-Type, Accept, Mcp-Session-Id, Last-Event-Id";

export function isLocalHttpHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

export function assertHttpServerSafety(config: AppConfig): void {
  if (config.mcpHttpHost.trim().length === 0) {
    throw new Error("MCP_HTTP_HOST cannot be empty.");
  }

  if (config.mcpHttpAllowedHosts.length === 0) {
    throw new Error("MCP_HTTP_ALLOWED_HOSTS must contain at least one allowed hostname.");
  }

  if (
    !isLocalHttpHost(config.mcpHttpHost) &&
    (!config.mcpHttpAllowNonLocalhost || !config.mcpHttpAuthToken)
  ) {
    throw new Error(
      "Refusing to bind MCP HTTP transport outside localhost without MCP_HTTP_ALLOW_NON_LOCALHOST=true and MCP_HTTP_AUTH_TOKEN."
    );
  }
}

export function isAllowedHttpOrigin(origin: string | undefined, config: AppConfig): boolean {
  if (!origin) {
    return true;
  }

  if (config.mcpHttpAllowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return isLocalHttpHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isAuthorizedHttpRequest(authorizationHeader: string | undefined, config: AppConfig): boolean {
  if (!config.mcpHttpAuthToken) {
    return true;
  }

  if (!authorizationHeader) {
    return false;
  }

  const [scheme, token] = authorizationHeader.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token === config.mcpHttpAuthToken;
}

function applyCorsHeaders(req: HttpRequest, res: JsonHttpResponse): void {
  const origin = req.headers.origin;

  if (!origin) {
    return;
  }

  const requestedHeaders = req.headers["access-control-request-headers"];
  const allowedHeaders = typeof requestedHeaders === "string" && requestedHeaders.trim().length > 0
    ? requestedHeaders
    : defaultCorsAllowedHeaders;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", corsAllowedMethods);
  res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Max-Age", "600");
}

export function createHttpApp(config: AppConfig = loadConfig()) {
  assertHttpServerSafety(config);

  const app = createMcpExpressApp({
    host: config.mcpHttpHost,
    allowedHosts: [...config.mcpHttpAllowedHosts]
  });

  app.use((req: HttpRequest, res: JsonHttpResponse, next: NextFunction) => {
    if (!isAllowedHttpOrigin(req.headers.origin, config)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Origin is not allowed for this MCP HTTP server."
        },
        id: null
      });
      return;
    }

    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204);
      res.end();
      return;
    }

    if (!isAuthorizedHttpRequest(req.headers.authorization, config)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Missing or invalid MCP HTTP bearer token."
        },
        id: null
      });
      return;
    }

    next();
  });

  app.post(config.mcpHttpPath, async (req: HttpRequest, res: JsonHttpResponse) => {
    const { server } = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      await transport.close();
      await server.close();

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error"
          },
          id: null
        });
      }
    }
  });

  app.get(config.mcpHttpPath, (_req: HttpRequest, res: JsonHttpResponse) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete(config.mcpHttpPath, (_req: HttpRequest, res: JsonHttpResponse) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  return app;
}

export async function runHttpServer(config: AppConfig = loadConfig()): Promise<void> {
  const app = createHttpApp(config);

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(config.mcpHttpPort, config.mcpHttpHost, () => {
      console.error(
        `GitLab MCP HTTP server listening on http://${config.mcpHttpHost}:${config.mcpHttpPort}${config.mcpHttpPath}`
      );
      resolve();
    });

    listener.once("error", reject);
  });
}

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  ChatServiceError,
  closeMcpConnection,
  generateChatResponse,
  type ChatMessage,
} from "./ai.js";

const port = Number(process.env.PORT ?? 3000);
const maxSessionCount = 100;
const maxHistoryMessages = 20;
const sessionLifetimeMs = 30 * 60 * 1000;

const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    sessionId: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

interface ConversationSession {
  messages: ChatMessage[];
  lastActivity: number;
}

interface RequestTiming {
  requestId: string;
  startedAt: number;
}

const sessions = new Map<string, ConversationSession>();
const requestTimings = new WeakMap<Request, RequestTiming>();
const app = express();

app.disable("x-powered-by");
app.use((request, response, next) => {
  if (request.method === "POST" && request.path === "/api/chat") {
    const timing = { requestId: randomUUID(), startedAt: performance.now() };
    requestTimings.set(request, timing);
    response.setHeader("X-Request-Id", timing.requestId);
  }
  next();
});
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "ai-inventory-backend" });
});

app.post("/api/chat", async (request: Request, response: Response) => {
  const timing = requestTimings.get(request) ?? {
    requestId: randomUUID(),
    startedAt: performance.now(),
  };
  response.setHeader("X-Request-Id", timing.requestId);
  const logTotal = (statusCode: number) =>
    logTotalApiResponse(timing, statusCode);

  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    logTotal(400);
    response.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const sessionId = parsed.data.sessionId ?? randomUUID();
  const now = Date.now();
  expireSessions(now);
  const session = sessions.get(sessionId);
  const priorMessages = session?.messages ?? [];

  try {
    const answer = await generateChatResponse(
      parsed.data.message,
      priorMessages,
      timing.requestId,
    );
    const messages = [
      ...priorMessages,
      { role: "user" as const, content: parsed.data.message },
      { role: "model" as const, content: answer },
    ].slice(-maxHistoryMessages);

    sessions.set(sessionId, { messages, lastActivity: Date.now() });
    logTotal(200);
    response.json({ sessionId, response: answer });
  } catch (error) {
    if (error instanceof ChatServiceError) {
      logTotal(error.statusCode);
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error("Unexpected chat request failure.");
    logTotal(500);
    response.status(500).json({ error: "The chat request could not be completed." });
  }
});

app.use(
  (
    error: unknown,
    request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.parse.failed"
    ) {
      logRequestError(request, response, 400);
      response.status(400).json({ error: "Request body must contain valid JSON." });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      logRequestError(request, response, 413);
      response.status(413).json({ error: "Request body is too large." });
      return;
    }

    console.error("Unexpected HTTP request failure.");
    logRequestError(request, response, 500);
    response.status(500).json({ error: "The request could not be completed." });
  },
);

function logTotalApiResponse(
  timing: RequestTiming,
  statusCode: number,
): void {
  console.info(
    JSON.stringify({
      type: "performance",
      requestId: timing.requestId,
      stage: "total_api_response",
      durationMs: Math.round(performance.now() - timing.startedAt),
      statusCode,
    }),
  );
}

function logRequestError(
  request: Request,
  response: Response,
  statusCode: number,
): void {
  const timing = requestTimings.get(request);
  if (!timing || response.headersSent) {
    return;
  }
  response.setHeader("X-Request-Id", timing.requestId);
  logTotalApiResponse(timing, statusCode);
}

function expireSessions(now: number): void {
  for (const [sessionId, session] of sessions) {
    if (now - session.lastActivity > sessionLifetimeMs) {
      sessions.delete(sessionId);
    }
  }
  while (sessions.size >= maxSessionCount) {
    const oldestSessionId = sessions.keys().next().value as string | undefined;
    if (!oldestSessionId) {
      return;
    }
    sessions.delete(oldestSessionId);
  }
}

export function startApiServer(): Server {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const server = createServer(app);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Inventory chat API listening at http://127.0.0.1:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down chat API...`);
    server.close((error) => {
      if (error) {
        console.error("Error while closing chat API.");
        process.exitCode = 1;
      }
      sessions.clear();
      void closeMcpConnection()
        .catch(() => {
          console.error("Could not close the persistent MCP client.");
          process.exitCode = 1;
        })
        .finally(() => console.log("Chat API shut down."));
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    startApiServer();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Failed to start chat API.",
    );
    process.exitCode = 1;
  }
}

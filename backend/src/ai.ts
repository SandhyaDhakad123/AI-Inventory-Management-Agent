import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client";
import dotenv from "dotenv";

const defaultGeminiModel = "gemini-3.5-flash-lite";
const defaultMcpServerUrl = "http://127.0.0.1:3001/mcp";
const geminiTimeoutMs = 20_000;
const mcpTimeoutMs = 5_000;
const maxGeminiCalls = 3;
const chatDeadlineMs = 45_000;

const requiredToolNames = [
  "search_products",
  "get_stock_status",
  "update_stock",
  "add_product",
] as const;

const environmentCandidates = [
  resolve(__dirname, "../../.env"),
  resolve(__dirname, "../../../.env"),
];
const environmentFile =
  environmentCandidates.find((candidate) => existsSync(candidate)) ??
  environmentCandidates[0];
if (environmentFile) {
  dotenv.config({ path: environmentFile, quiet: true });
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export class ChatServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChatServiceError";
  }
}

interface McpConnection {
  client: Client;
  declarations: FunctionDeclaration[];
  toolNames: Set<string>;
  toolsByName: Map<string, Tool>;
  knownSkus: Set<string>;
}

interface McpConnectionResult {
  connection: McpConnection;
  reused: boolean;
}

interface ToolExecution {
  responsePart: Part;
  result: Record<string, unknown>;
  durationMs: number;
}

let geminiClient: GoogleGenAI | undefined;
let mcpConnection: McpConnection | undefined;
let mcpConnectionPromise: Promise<McpConnection> | undefined;

function logStage(
  requestId: string,
  stage: string,
  durationMs: number,
  details: Record<string, string | number | boolean> = {},
): void {
  console.info(
    JSON.stringify({
      type: "performance",
      requestId,
      stage,
      durationMs: Math.round(durationMs),
      ...details,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ChatServiceError(`${name} is not configured.`, 503);
  }
  return value.trim();
}

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: requiredString(process.env.GEMINI_API_KEY, "GEMINI_API_KEY"),
      httpOptions: {
        timeout: geminiTimeoutMs,
        retryOptions: { attempts: 1 },
      },
    });
  }
  return geminiClient;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || defaultGeminiModel;
}

function getMcpServerUrl(): URL {
  const configured = process.env.MCP_SERVER_URL ?? defaultMcpServerUrl;
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol.");
    }
    return url;
  } catch {
    throw new ChatServiceError("MCP_SERVER_URL is not a valid HTTP URL.", 500);
  }
}

function toGeminiDeclaration(tool: Tool): FunctionDeclaration {
  const schema = tool.inputSchema;
  if (!schema || schema.type !== "object") {
    throw new ChatServiceError(
      `MCP tool "${tool.name}" has an unsupported input schema.`,
      502,
    );
  }

  const {
    $schema: _schema,
    $id: _id,
    title: _title,
    ...parametersJsonSchema
  } = schema;

  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parametersJsonSchema,
  };
}

async function createMcpConnection(requestId: string): Promise<McpConnection> {
  const client = new Client({ name: "inventory-gemini-agent", version: "1.0.0" });
  try {
    const connectionStarted = performance.now();
    try {
      await client.connect(
        new StreamableHTTPClientTransport(getMcpServerUrl()),
        { timeout: mcpTimeoutMs },
      );
    } catch (error) {
      logStage(requestId, "mcp_connection", performance.now() - connectionStarted, {
        reused: false,
        success: false,
      });
      throw error;
    }
    logStage(requestId, "mcp_connection", performance.now() - connectionStarted, {
      reused: false,
      success: true,
    });

    const discoveryStarted = performance.now();
    let tools: Tool[];
    try {
      ({ tools } = await client.listTools({}, { timeout: mcpTimeoutMs }));
    } catch (error) {
      logStage(requestId, "mcp_tool_discovery", performance.now() - discoveryStarted, {
        cached: false,
        success: false,
      });
      throw error;
    }
    logStage(requestId, "mcp_tool_discovery", performance.now() - discoveryStarted, {
      cached: false,
      toolCount: tools.length,
      success: true,
    });

    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const missingTools = requiredToolNames.filter((name) => !toolsByName.has(name));
    if (missingTools.length > 0) {
      throw new ChatServiceError(
        `The inventory MCP server is missing required tools: ${missingTools.join(", ")}.`,
        502,
      );
    }

    return {
      client,
      declarations: tools.map(toGeminiDeclaration),
      toolNames: new Set(tools.map((tool) => tool.name)),
      toolsByName,
      knownSkus: new Set(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function getMcpConnection(
  requestId: string,
): Promise<McpConnectionResult> {
  if (mcpConnection) {
    logStage(requestId, "mcp_connection", 0, {
      reused: true,
      success: true,
    });
    return { connection: mcpConnection, reused: true };
  }

  const started = performance.now();
  const reused = mcpConnectionPromise !== undefined;
  if (!mcpConnectionPromise) {
    mcpConnectionPromise = createMcpConnection(requestId);
  }

  try {
    mcpConnection = await mcpConnectionPromise;
    if (reused) {
      logStage(requestId, "mcp_connection", performance.now() - started, {
        reused: true,
        success: true,
      });
    }
    return { connection: mcpConnection, reused };
  } catch (error) {
    mcpConnectionPromise = undefined;
    if (error instanceof ChatServiceError) {
      throw error;
    }
    throw new ChatServiceError(
      "The inventory MCP server is unavailable. Start the MCP server and try again.",
      503,
      { cause: error },
    );
  } finally {
    if (mcpConnection) {
      mcpConnectionPromise = undefined;
    }
  }
}

export async function closeMcpConnection(): Promise<void> {
  const pendingConnection = mcpConnectionPromise;
  if (pendingConnection) {
    await pendingConnection.catch(() => undefined);
  }

  const connection = mcpConnection;
  mcpConnection = undefined;
  mcpConnectionPromise = undefined;
  if (connection) {
    await connection.client.close();
  }
}

function toUserContext(history: ChatMessage[], message: string): string {
  return [...history, { role: "user", content: message }]
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join("\n");
}

function hasExplicitMutationIntent(toolName: string, context: string): boolean {
  if (toolName === "update_stock") {
    return (
      /\b(update|set(?:ting)?|change|adjust|increase|decrease|reduce|restock(?:ing)?)\b/i.test(context) &&
      /\b(stock|inventory|quantity|units|restock)\b/i.test(context)
    );
  }
  if (toolName === "add_product") {
    return (
      /\b(add(?:ing)?|creat(?:e|ing)|register(?:ing)?|introduc(?:e|ing))\b/i.test(context) &&
      /\b(product|item|inventory)\b/i.test(context)
    );
  }
  return true;
}

function hasNumericValueInContext(value: unknown, context: string): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  const numericValues =
    context.match(/(?<![\w.-])\d+(?:,\d{3})*(?:\.\d+)?(?![\w]|\.\d|,\d)/g) ?? [];
  return numericValues.some(
    (numericText) => Number(numericText.replaceAll(",", "")) === value,
  );
}

function hasTextValueInContext(value: unknown, context: string): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    context.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())
  );
}

function mutationAuthorizationError(
  toolName: string,
  args: Record<string, unknown>,
  context: string,
  knownSkus: Set<string>,
): string | undefined {
  if (!hasExplicitMutationIntent(toolName, context)) {
    return "Not executed because the user has not clearly requested this change. Ask for explicit confirmation.";
  }

  if (toolName === "update_stock") {
    const sku = args.sku;
    if (
      typeof sku !== "string" ||
      (!context.toLocaleLowerCase().includes(sku.toLocaleLowerCase()) &&
        !knownSkus.has(sku))
    ) {
      return "Not executed because a product SKU was not specified or resolved from inventory results. Ask which product to update.";
    }
    if (!hasNumericValueInContext(args.quantity, context)) {
      return "Not executed because the requested quantity was not explicitly provided. Ask what quantity to set.";
    }
  }

  if (toolName === "add_product") {
    const requiredTextFields = [
      "category",
      "productName",
      "sku",
      "variantName",
    ] as const;
    for (const field of requiredTextFields) {
      if (!hasTextValueInContext(args[field], context)) {
        return `Not executed because ${field} was not explicitly provided. Ask the user for it.`;
      }
    }
    if (!hasNumericValueInContext(args.price, context)) {
      return "Not executed because the product price was not explicitly provided. Ask the user for it.";
    }
    if (!hasNumericValueInContext(args.initialQuantity, context)) {
      return "Not executed because the initial quantity was not explicitly provided. Ask the user for it.";
    }
  }

  return undefined;
}

function updateKnownSkus(value: unknown, knownSkus: Set<string>): void {
  if (!isRecord(value) || !Array.isArray(value.products)) {
    return;
  }
  for (const product of value.products) {
    if (isRecord(product) && typeof product.sku === "string") {
      knownSkus.add(product.sku);
    }
  }
}

function parseToolResult(
  result: Awaited<ReturnType<Client["callTool"]>>,
): Record<string, unknown> {
  if (isRecord(result.structuredContent)) {
    return { ...result.structuredContent, success: !result.isError };
  }

  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) {
        return { ...parsed, success: !result.isError };
      }
    } catch {
      return { success: !result.isError, message: text };
    }
  }
  return { success: !result.isError, message: "The MCP tool returned no data." };
}

function functionResponsePart(
  call: FunctionCall,
  name: string,
  response: Record<string, unknown>,
): Part {
  return {
    functionResponse: {
      name,
      ...(call.id ? { id: call.id } : {}),
      response,
    },
  };
}

async function executeMcpTool(
  connection: McpConnection,
  call: FunctionCall,
  userContext: string,
  requestId: string,
): Promise<ToolExecution> {
  const started = performance.now();
  const name = call.name ?? "unknown";
  let result: Record<string, unknown>;

  if (!call.name || !connection.toolNames.has(call.name)) {
    result = {
      success: false,
      message: "Gemini requested a tool that is not available from the MCP server.",
    };
  } else if (!isRecord(call.args)) {
    result = {
      success: false,
      message: "Gemini provided invalid tool arguments; provide arguments as a JSON object.",
    };
  } else {
    const authorizationError = mutationAuthorizationError(
      name,
      call.args,
      userContext,
      connection.knownSkus,
    );
    if (authorizationError) {
      result = { success: false, message: authorizationError };
    } else {
      try {
        const tool = connection.toolsByName.get(name);
        const toolResult = await connection.client.callTool(
          { name, arguments: call.args },
          {
            timeout: mcpTimeoutMs,
            ...(tool ? { toolDefinition: tool } : {}),
          },
        );
        result = parseToolResult(toolResult);
        updateKnownSkus(result, connection.knownSkus);
      } catch (error) {
        mcpConnection = undefined;
        mcpConnectionPromise = undefined;
        result = {
          success: false,
          message:
            error instanceof Error && /timeout/i.test(error.message)
              ? "The inventory MCP tool timed out. Please try again."
              : "The inventory MCP tool call failed. Check its arguments and confirm the inventory service is available.",
        };
      }
    }
  }

  const durationMs = performance.now() - started;
  logStage(requestId, "mcp_tool_execution", durationMs, {
    tool: name,
    success: result.success === true,
  });
  return {
    responsePart: functionResponsePart(call, name, result),
    result,
    durationMs,
  };
}

function formatToolResult(name: string, result: Record<string, unknown>): string {
  if (result.success !== true) {
    return typeof result.message === "string"
      ? result.message
      : "The requested inventory operation could not be completed.";
  }

  if (
    (name === "search_products" || name === "get_stock_status") &&
    Array.isArray(result.products)
  ) {
    const products = result.products.filter(isRecord);
    if (products.length === 0) {
      return "No matching inventory products were found.";
    }
    const heading =
      typeof result.status === "string"
        ? `${products.length} ${result.status.replaceAll("_", " ")} product${products.length === 1 ? "" : "s"}:`
        : `${products.length} matching product${products.length === 1 ? "" : "s"}:`;
    const rows = products.map((product) => {
      const fields = [
        typeof product.productName === "string" ? product.productName : "Product",
        typeof product.sku === "string" ? `SKU ${product.sku}` : undefined,
        typeof product.category === "string" ? product.category : undefined,
        typeof product.variant === "string" ? product.variant : undefined,
        typeof product.price === "number" ? `price ${product.price}` : undefined,
        typeof product.quantity === "number" ? `stock ${product.quantity}` : undefined,
        typeof product.reorderLevel === "number"
          ? `reorder level ${product.reorderLevel}`
          : undefined,
      ].filter((field): field is string => field !== undefined);
      return `- ${fields.join(" · ")}`;
    });
    return `${heading}\n${rows.join("\n")}`;
  }

  if (typeof result.message === "string") {
    const details =
      name === "update_stock" && typeof result.quantity === "number"
        ? ` Quantity: ${result.quantity}.`
        : name === "add_product" && typeof result.sku === "string"
          ? ` SKU: ${result.sku}.`
          : "";
    return `${result.message}${details}`;
  }
  return JSON.stringify(result);
}

function remainingTime(deadline: number): number {
  const timeLeft = deadline - performance.now();
  if (timeLeft <= 0) {
    throw new ChatServiceError(
      "The inventory request timed out. Please try again.",
      504,
    );
  }
  return Math.max(1, Math.floor(timeLeft));
}

function geminiError(error: unknown): ChatServiceError {
  const status =
    isRecord(error) && typeof error.status === "number" ? error.status : undefined;
  const message =
    isRecord(error) && typeof error.message === "string" ? error.message : "";
  if (
    status === 401 ||
    status === 403 ||
    /api key.{0,30}(invalid|not valid)|invalid api key|unauthorized/i.test(message)
  ) {
    return new ChatServiceError(
      "Gemini rejected GEMINI_API_KEY. Check that the backend API key is valid and enabled.",
      502,
      { cause: error },
    );
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return new ChatServiceError(
      "Gemini took too long to respond. Please try again.",
      504,
      { cause: error },
    );
  }
  return new ChatServiceError(
    "Gemini could not complete the request. Please try again.",
    502,
    { cause: error },
  );
}

function contentParts(response: Content | undefined): Part[] {
  return response?.parts ? [...response.parts] : [];
}

export async function generateChatResponse(
  message: string,
  history: ChatMessage[] = [],
  requestId = "unknown",
): Promise<string> {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new ChatServiceError(
      "Gemini is not configured. Set GEMINI_API_KEY in the project environment file.",
      503,
    );
  }

  const deadline = performance.now() + chatDeadlineMs;
  const { connection, reused } = await getMcpConnection(requestId);
  if (reused) {
    logStage(requestId, "mcp_tool_discovery", 0, {
      cached: true,
      toolCount: connection.declarations.length,
    });
  }

  const userContext = toUserContext(history, message);
  const contents: Content[] = [
    ...history.map((entry) => ({
      role: entry.role,
      parts: [{ text: entry.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];
  const toolResults: Array<{ name: string; result: Record<string, unknown> }> = [];
  const model = getGeminiModel();

  for (let round = 0; round < maxGeminiCalls; round += 1) {
    const geminiStarted = performance.now();
    let response;
    try {
      response = await getGeminiClient().models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: [
            "You are a concise inventory management assistant.",
            "Use the supplied MCP tools for live inventory information and actions.",
            "Never claim an operation succeeded unless the MCP result confirms it.",
            "For stock changes and product creation, execute when the user's request is explicit and all required values are present. Do not ask for extra confirmation in that case. If any value is missing or ambiguous, ask for it rather than guessing.",
            "Use inventory search results to resolve a product name to its SKU when the user explicitly requested a stock change.",
            "Do not repeat or embellish inventory data returned by tools.",
          ].join(" "),
          tools: [{ functionDeclarations: connection.declarations }],
          httpOptions: {
            timeout: Math.min(geminiTimeoutMs, remainingTime(deadline)),
            retryOptions: { attempts: 1 },
          },
        },
      });
    } catch (error) {
      const durationMs = performance.now() - geminiStarted;
      const errorDetails = isRecord(error)
        ? {
            errorName:
              typeof error.name === "string" ? error.name : "GeminiRequestError",
            ...(typeof error.status === "number"
              ? { httpStatus: error.status }
              : {}),
            ...(typeof error.code === "string" || typeof error.code === "number"
              ? { errorCode: error.code }
              : {}),
          }
        : { errorName: "GeminiRequestError" };
      logStage(requestId, "gemini_api_request", durationMs, {
        round: round + 1,
        model,
        success: false,
        ...errorDetails,
      });
      throw geminiError(error);
    }
    const durationMs = performance.now() - geminiStarted;
    const calls = response.functionCalls ?? [];
    logStage(requestId, "gemini_api_request", durationMs, {
      round: round + 1,
      model,
      success: true,
      functionCallCount: calls.length,
    });

    const candidateContent = response.candidates?.[0]?.content;
    if (calls.length === 0) {
      const answer =
        response.text?.trim() ??
        contentParts(candidateContent)
          .filter((part) => typeof part.text === "string")
          .map((part) => part.text)
          .join("")
          .trim();
      if (!answer) {
        throw new ChatServiceError(
          "Gemini returned an empty response. Please try rephrasing your request.",
          502,
        );
      }
      logStage(requestId, "final_gemini_response", durationMs, {
        source: "gemini",
      });
      return answer;
    }

    contents.push({ role: "model", parts: contentParts(candidateContent) });
    const executions = await Promise.all(
      calls.map((call) =>
        executeMcpTool(connection, call, userContext, requestId),
      ),
    );
    for (let index = 0; index < executions.length; index += 1) {
      const execution = executions[index];
      const call = calls[index];
      if (execution && call) {
        toolResults.push({
          name: call.name ?? "unknown",
          result: execution.result,
        });
      }
    }

    const needsFollowup =
      executions.some(
        (execution, index) =>
          calls[index]?.name === "search_products" &&
          toolResults.some(({ name }) => name === "search_products") &&
          hasExplicitMutationIntent("update_stock", message) &&
          executions[index]?.result.success === true,
      ) &&
      executions.every((execution) => execution.result.success === true);

    if (!needsFollowup) {
      const finalResponse = toolResults
        .map(({ name, result }) => formatToolResult(name, result))
        .join("\n\n");
      logStage(requestId, "final_gemini_response", 0, {
        source: "mcp_tool_results",
        skippedSynthesis: true,
      });
      return finalResponse;
    }

    contents.push({
      role: "user",
      parts: executions.map((execution) => execution.responsePart),
    });
  }

  if (toolResults.length > 0) {
    const response = toolResults
      .map(({ name, result }) => formatToolResult(name, result))
      .join("\n\n");
    logStage(requestId, "final_gemini_response", 0, {
      source: "mcp_tool_results",
      skippedSynthesis: true,
      maxGeminiCallsReached: true,
    });
    return response;
  }

  throw new ChatServiceError(
    "The request required too many Gemini tool-calling steps. Please try a more specific request.",
    502,
  );
}

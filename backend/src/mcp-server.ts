import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import {
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport,
} from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import {
  addProduct,
  getStockStatus,
  searchProducts,
  updateStock,
  type OperationResult,
  type ProductInventory,
} from "./inventory.js";
import { db } from "./db.js";

const serverInfo = { name: "ai-inventory-agent", version: "1.0.0" };
const mcpPath = "/mcp";
const defaultPort = 3001;

type ToolPayload = Record<string, unknown>;

function toolResponse(payload: ToolPayload, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function operationResponse<T extends ToolPayload>(
  result: OperationResult<T>,
): ReturnType<typeof toolResponse> {
  return toolResponse(
    result.success
      ? { success: true, message: result.message, ...result.data }
      : { success: false, message: result.message },
    !result.success,
  );
}

function formatToolError(toolName: string, error: unknown) {
  console.error(`MCP tool "${toolName}" failed:`, error);
  return toolResponse(
    { success: false, message: `The ${toolName} operation failed unexpectedly.` },
    true,
  );
}

function createMcpServer(): McpServer {
  const server = new McpServer(serverInfo);

  server.registerTool(
    "search_products",
    {
      description:
        "Search inventory products by product name, SKU, or category. Returns product, category, variant, price, quantity, and reorder-level details.",
      inputSchema: z.object({
        query: z.string().trim().describe("Text to match against product name, SKU, or category."),
      }),
    },
    async ({ query }) => {
      try {
        const products: ProductInventory[] = searchProducts(query);
        return toolResponse({ success: true, count: products.length, products });
      } catch (error) {
        return formatToolError("search_products", error);
      }
    },
  );

  server.registerTool(
    "get_stock_status",
    {
      description:
        "List inventory matching low_stock, out_of_stock, or available status.",
      inputSchema: z.object({
        status: z.enum(["low_stock", "out_of_stock", "available"]),
      }),
    },
    async ({ status }) => {
      try {
        const products: ProductInventory[] = getStockStatus(status);
        return toolResponse({ success: true, status, count: products.length, products });
      } catch (error) {
        return formatToolError("get_stock_status", error);
      }
    },
  );

  server.registerTool(
    "update_stock",
    {
      description:
        "Set the inventory quantity for an existing product variant identified by SKU.",
      inputSchema: z.object({
        sku: z.string().trim().min(1).describe("Existing product variant SKU."),
        quantity: z.number().int().nonnegative().describe("New non-negative stock quantity."),
      }),
    },
    async ({ sku, quantity }) => {
      try {
        return operationResponse(updateStock(sku, quantity));
      } catch (error) {
        return formatToolError("update_stock", error);
      }
    },
  );

  server.registerTool(
    "add_product",
    {
      description:
        "Add a product, variant, and inventory record. Creates the category if it does not already exist; SKU must be unique.",
      inputSchema: z.object({
        category: z.string().trim().min(1),
        productName: z.string().trim().min(1),
        description: z.string().optional(),
        sku: z.string().trim().min(1),
        variantName: z.string().trim().min(1),
        price: z.number().finite().nonnegative(),
        initialQuantity: z.number().int().nonnegative(),
      }),
    },
    async (input) => {
      try {
        const productInput = {
          category: input.category,
          productName: input.productName,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          sku: input.sku,
          variantName: input.variantName,
          price: input.price,
          initialQuantity: input.initialQuantity,
        };
        return operationResponse(addProduct(productInput));
      } catch (error) {
        return formatToolError("add_product", error);
      }
    },
  );

  return server;
}

function getPort(): number {
  const configuredPort = process.env.MCP_PORT;
  if (configuredPort === undefined) {
    return defaultPort;
  }

  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const mcpServer = createMcpServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error("MCP HTTP request failed:", error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Internal MCP server error." }));
    } else if (!response.writableEnded) {
      response.end();
    }
  } finally {
    await mcpServer.close().catch((error: unknown) => {
      console.error("Failed to close request-scoped MCP server:", error);
    });
  }
}

export function startMcpServer(port = getPort()): Server {
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const httpServer = createServer((request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) {
      return;
    }

    if (request.url === "/health" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: serverInfo.name }));
      return;
    }

    if (request.url !== mcpPath) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found." }));
      return;
    }

    if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
      response.writeHead(405, { Allow: "GET, POST, DELETE" });
      response.end();
      return;
    }

    void handleMcpRequest(request, response);
  });

  httpServer.on("error", (error) => {
    console.error("MCP HTTP server error:", error);
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`Inventory MCP server listening at http://127.0.0.1:${port}${mcpPath}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down MCP server...`);
    httpServer.close((error) => {
      if (error) {
        console.error("Error while closing MCP HTTP server:", error);
        process.exitCode = 1;
      }
      if (db.open) {
        db.close();
      }
      console.log("MCP server shut down.");
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return httpServer;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    startMcpServer();
  } catch (error) {
    console.error("Failed to start MCP server:", error);
    db.close();
    process.exitCode = 1;
  }
}

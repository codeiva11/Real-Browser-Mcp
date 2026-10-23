

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

const { TOOLS } = require('../shared/tools');
const { executeTool, cleanup, setProgressCallback } = require('./handlers');

// ───────────────────────────────────────────────────────────────────────────
// Global result-size guard (P0)
//
// Strict MCP clients (Anthropic) require every tool_use to be answered by a
// tool_result that survives in the conversation history. A multi-MB result
// (full page HTML, thousands of network records, a raw JS return value)
// forces the client to compact/truncate history — and dropping one
// tool_result orphans its tool_use, which Anthropic rejects with a 400.
// So EVERY tool result passes through this single choke point: above
// MAX_RESULT_CHARS the payload is replaced by a small truncation notice
// with a preview, no matter which handler produced it.
// ───────────────────────────────────────────────────────────────────────────
const MAX_RESULT_CHARS = parseInt(process.env.REAL_BROWSER_MAX_RESULT_CHARS || '200000', 10);
// Chars of the original payload kept as a preview inside a truncation notice.
const RESULT_PREVIEW_CHARS = 20000;
// At or below this size results keep the historical pretty-printed JSON;
// above it they are serialized compactly to avoid pretty-print inflation.
const COMPACT_JSON_THRESHOLD_CHARS = 20000;

function truncationNotice(serialized: string, success: unknown): string {
  return JSON.stringify(
    {
      ...(typeof success === 'boolean' ? { success } : {}),
      truncated: true,
      originalSizeChars: serialized.length,
      note:
        `Result exceeded ${MAX_RESULT_CHARS} chars and was truncated to protect the conversation context. ` +
        'Narrow the request (use limit/offset, a selector, or a smaller page region).',
      preview: serialized.slice(0, RESULT_PREVIEW_CHARS),
    },
    null,
    2
  );
}

// Serialize a result object for the text path, applying the global cap.
function serializeResultText(result: any): string {
  let text = JSON.stringify(result);
  if (typeof text !== 'string') text = String(text);
  if (text.length <= COMPACT_JSON_THRESHOLD_CHARS) {
    text = JSON.stringify(result, null, 2);
  }
  if (text.length > MAX_RESULT_CHARS) {
    return truncationNotice(text, result?.success);
  }
  return text;
}

// Apply the same cap to the text blocks of an mcpContent array. Image
// blocks are left untouched (screenshot size is bounded at capture time in
// see_page); only text blocks can carry unbounded payloads.
function guardMcpContent(content: any[], success: unknown): any[] {
  if (!Array.isArray(content)) return content;
  return content.map((block: any) => {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length > MAX_RESULT_CHARS) {
      return { ...block, text: truncationNotice(block.text, success) };
    }
    return block;
  });
}

// The progressToken of the in-flight tool call, captured from the request's
// _meta.progressToken (MCP spec) so notifications carry the client's token.
let activeProgressToken: unknown = undefined;

/**
 * Deliver progress notifications to the MCP client as real JSON-RPC
 * notifications (notifications/progress). The client only opts in when it
 * negotiated the 'progress' capability; an unfiltered stream of
 * notifications can spam STDIO, so we gate delivery behind an env flag that
 * is opt-in: REAL_BROWSER_SEND_PROGRESS=1.
 */
function wireProgressNotifications(server: any) {
  setProgressCallback((notification: any) => {
    if (process.env.REAL_BROWSER_SEND_PROGRESS !== '1') return;
    try {
      const { tool, status, message, timestamp, data } = notification;
      // MCP spec: `progress` must be a number 0-100. We don't have real
      // completion percentages, so started/progress map to 0 and terminal
      // states to 100 — the client at least sees a well-formed notification.
      const progressValue = status === 'completed' || status === 'error' ? 100 : 0;
      server.notification({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: {
          progressToken: activeProgressToken,
          progress: progressValue,
          value: {
            tool,
            status,
            message,
            timestamp,
            ...(data || {}),
          },
        },
      } as any);
    } catch (e) {
      // Notification delivery must never break the tool result.
    }
  });
}

// Single source of truth: read version from package.json (avoids version drift)
let PKG_VERSION = '0.0.0';
try {
  PKG_VERSION = require('../../package.json').version || PKG_VERSION;
} catch (e: any) {
  try {
    PKG_VERSION = require('../../../package.json').version || PKG_VERSION;
  } catch (err: any) {
    console.error('⚠️  Could not read version from package.json:', err.message);
  }
}

/**
 * Create and configure MCP Server
 */
function createServer() {
  const server = new Server(
    {
      name: 'real-browser-mcp-server',
      version: PKG_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;
    // Remember the client's progress token for this call so progress
    // notifications can carry it (MCP spec). Tools run sequentially, so a
    // module-level slot is correct here.
    activeProgressToken = request.params?._meta?.progressToken;

    // Find tool definition
    const tool = TOOLS.find((t: any) => t.name === name);
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`
      );
    }

    try {
      // Execute the tool
      const result = await executeTool(name, args || {});

      // Format response
      if (result.success === false && result.error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      if (result.mcpContent) {
        return { content: guardMcpContent(result.mcpContent, result.success) };
      }

      return {
        content: [
          {
            type: 'text',
            text: serializeResultText(result),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start MCP Server with STDIO transport
 */
async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();

  // Connect progress notifications before accepting requests.
  wireProgressNotifications(server);

  // Connect server to transport
  await server.connect(transport);

  return { server, transport };
}

/**
 * Graceful shutdown
 */
async function shutdownServer(server: any) {
  // Cleanup browser resources
  await cleanup();

  // Close server
  if (server) {
    await server.close();
  }
}

module.exports = {
  createServer,
  startServer,
  shutdownServer,
};

export {}

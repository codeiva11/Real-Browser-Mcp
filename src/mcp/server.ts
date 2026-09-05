

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
      name: 'real-browser-mcp',
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
        return { content: result.mcpContent };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
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

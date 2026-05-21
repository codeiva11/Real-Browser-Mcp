/**
 * Brave Real Browser MCP Server
 * 
 * Model Context Protocol Server with STDIO Transport
 * Supports: Claude, Cursor, Copilot, and other MCP-compatible AI assistants
 */

// CRITICAL: Redirect ALL console.log to STDERR before ANY imports
// MCP uses STDIO transport — STDOUT must contain ONLY JSON-RPC messages.
// Any console.log from this code or ANY dependency (browser, blocker, etc.)
// will corrupt the JSON-RPC stream and cause parsing errors.
const _originalConsoleLog = console.log;
console.log = function (...args) {
  console.error(...args);
};

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

const { TOOLS } = require('./tools.js');
const { executeTool, cleanup } = require('./handlers.js');

/**
 * Create and configure MCP Server
 */
function createServer() {
  const server = new Server(
    {
      name: 'real-browser-mcp-server',
      version: '2.48.36',
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
      tools: TOOLS.map(tool => ({
        name: tool.name,
        description: `${tool.emoji} ${tool.description}`,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Find tool definition
    const tool = TOOLS.find(t => t.name === name);
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
    } catch (error) {
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

  // Connect server to transport
  await server.connect(transport);

  return { server, transport };
}

/**
 * Graceful shutdown
 */
async function shutdownServer(server) {
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

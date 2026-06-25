

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

const { TOOLS } = require('../shared/tools');
const { executeTool, cleanup } = require('./handlers');

// Single source of truth: read version from package.json (avoids version drift)
let PKG_VERSION = '0.0.0';
try {
  PKG_VERSION = require('../../package.json').version || PKG_VERSION;
} catch (e: any) {
  console.error('⚠️  Could not read version from package.json:', e.message);
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
        description: `${tool.emoji} ${tool.description}`,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

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

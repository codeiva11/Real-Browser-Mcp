#!/usr/bin/env node
// CRITICAL: Protect STDOUT for MCP STDIO transport.
// MCP uses STDIO — STDOUT must contain ONLY JSON-RPC messages.
// Redirect console.log AND intercept process.stdout.write to STDERR.
console.log = function (...args) { console.error(...args); };

/**
 * Real Browser MCP Server - Entry Point
 * 
 * Usage:
 *   npm run dev     - Start MCP server
 *   npm run mcp     - Start MCP server (alias)
 * 
 * For AI Assistants:
 *   Claude Desktop, Cursor, Copilot, etc.
 */

const { TOOL_DISPLAY } = require('../shared/tools');
const { startServer, shutdownServer } = require('./server');
const { cleanup } = require('./handlers');

const { colors } = require('../shared/colors');

/**
 * Display startup banner and tools
 */
function displayStartupBanner() {
  console.error('');
  console.error(`${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.error(`${colors.bright}${colors.cyan}║${colors.reset}  ${colors.bright}${colors.magenta}🦁 Real Browser MCP Server${colors.reset}                                 ${colors.cyan}║${colors.reset}`);
  console.error(`${colors.bright}${colors.cyan}║${colors.reset}  ${colors.dim}Playwright + Patchright + Stealth + Turnstile${colors.reset}            ${colors.cyan}║${colors.reset}`);
  console.error(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.error('');

  console.error(`${colors.bright}${colors.green}📦 Available Tools (${TOOL_DISPLAY.length}):${colors.reset}`);
  console.error(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);

  // Display tools in 2 columns
  const half = Math.ceil(TOOL_DISPLAY.length / 2);

  for (let i = 0; i < half; i++) {
    const left = TOOL_DISPLAY[i];
    const right = TOOL_DISPLAY[i + half];

    const leftStr = left
      ? `${left.emoji} ${colors.yellow}${left.name.padEnd(22)}${colors.reset}`
      : '';
    const rightStr = right
      ? `${right.emoji} ${colors.yellow}${right.name}${colors.reset}`
      : '';

    console.error(`  ${leftStr}${rightStr}`);
  }

  console.error(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);
  console.error('');
  // Fetch SDK version dynamically
  let sdkVersion = 'Latest';
  try {
    const pkgPath = require('path').join(__dirname, '..', '..', 'package.json');
    const pkg = require('fs').readFileSync(pkgPath, 'utf8');
    const deps = JSON.parse(pkg).dependencies || {};
    if (deps['@modelcontextprotocol/sdk']) {
      sdkVersion = deps['@modelcontextprotocol/sdk'].replace(/[\^~]/g, '');
    }
  } catch (e) { /* ignore */ }

  console.error(`${colors.bright}${colors.blue}🔗 Transport:${colors.reset} STDIO (for MCP clients)`);
  console.error(`${colors.bright}${colors.blue}📡 Protocol:${colors.reset} Model Context Protocol (SDK v${sdkVersion})`);
  console.error('');
  console.error(`${colors.dim}Press CTRL+C to stop the server${colors.reset}`);
  console.error('');
}

/**
 * Display tool details (verbose mode)
 */
function displayToolDetails() {
  console.error(`${colors.bright}${colors.green}📋 Tool Details:${colors.reset}`);
  console.error('');

  for (const tool of TOOL_DISPLAY) {
    console.error(`  ${tool.emoji} ${colors.bright}${colors.yellow}${tool.name}${colors.reset}`);
    console.error(`     ${colors.dim}${tool.description}${colors.reset}`);
    if (tool.descriptionHindi) {
      console.error(`     ${colors.dim}(${tool.descriptionHindi})${colors.reset}`);
    }
    console.error('');
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers(server: any) {
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error('');
    console.error(`${colors.bright}${colors.yellow}🧹 Cleanup in progress...${colors.reset}`);

    try {
      await cleanup();
      console.error(`${colors.bright}${colors.green}✅ Browser closed${colors.reset}`);
    } catch (e) {
      console.error(`${colors.dim}Browser already closed${colors.reset}`);
    }

    try {
      await shutdownServer(server);
      console.error(`${colors.bright}${colors.green}✅ MCP Server stopped${colors.reset}`);
    } catch (e) {
      // Server may already be closed
    }

    console.error(`${colors.bright}${colors.magenta}👋 Goodbye!${colors.reset}`);
    console.error('');

    process.exit(0);
  };

  // Handle various termination signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

  // Log unexpected errors without turning one tool/background-task failure
  // into an MCP server shutdown. Explicit signals still use gracefulShutdown.
  process.on('uncaughtException', (error) => {
    console.error(`${colors.bright}${colors.red}❌ Uncaught Exception:${colors.reset}`, error?.message || error);
  });

  process.on('unhandledRejection', (reason: any) => {
    console.error(`${colors.bright}${colors.red}❌ Unhandled Rejection:${colors.reset}`, reason?.message || reason);
  });
}

/**
 * Main entry point
 */
async function main() {
  // Check for verbose flag
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  // Display startup info
  displayStartupBanner();

  if (verbose) {
    displayToolDetails();
  }

  try {
    // Start MCP server
    console.error(`${colors.bright}${colors.green}🚀 Starting MCP Server...${colors.reset}`);

    const { server } = await startServer();

    console.error(`${colors.bright}${colors.green}✅ MCP Server running${colors.reset}`);
    console.error(`${colors.dim}Waiting for client connections via STDIO...${colors.reset}`);
    console.error('');

    // Setup shutdown handlers
    setupShutdownHandlers(server);

  } catch (error: any) {
    console.error(`${colors.bright}${colors.red}❌ Failed to start server:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// Run main
main().catch((error: any) => {
  console.error(`${colors.bright}${colors.red}❌ Fatal error:${colors.reset}`, error.message);
  process.exit(1);
});

export {}

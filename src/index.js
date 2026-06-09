#!/usr/bin/env node
/**
 * Real Browser MCP Server
 * 
 * Usage:
 *   node src/index.js             - Start MCP Server (default)
 *   node src/index.js --help      - Show help
 *   node src/index.js --list      - List all available tools
 */

const { TOOLS, TOOL_DISPLAY, CATEGORIES } = require('./shared/tools.js');

// ANSI colors for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

/**
 * Display help message
 */
function showHelp() {
  console.log(`
${colors.bright}${colors.cyan}🦁 Real Browser MCP Server${colors.reset}

${colors.bright}USAGE:${colors.reset}
  node src/index.js [options]

${colors.bright}OPTIONS:${colors.reset}
  ${colors.yellow}--help, -h${colors.reset}    Show this help message
  ${colors.yellow}--verbose, -v${colors.reset} Show detailed tool information
  ${colors.yellow}--list${colors.reset}        List all available tools

${colors.bright}EXAMPLES:${colors.reset}
  node src/index.js              # Start MCP server
  node src/index.js --list       # List all tools

${colors.bright}NPM SCRIPTS:${colors.reset}
  npm run dev                    # Start MCP server
  npm run mcp                    # Start MCP server only

${colors.bright}ARCHITECTURE:${colors.reset}
  ${colors.cyan}MCP Server${colors.reset} → STDIO transport → AI Agents (Claude, Cursor, Copilot)

${colors.bright}TOOL CATEGORIES (${TOOLS.length} tools):${colors.reset}
${Object.entries(CATEGORIES).map(([key, cat]) => {
  const count = TOOLS.filter(t => t.category === key).length;
  return `  ${cat.emoji} ${colors.yellow}${cat.name.padEnd(15)}${colors.reset} ${colors.dim}(${count} tools)${colors.reset}`;
}).join('\n')}
  `);
}

/**
 * List all available tools
 */
function listTools() {
  console.log(`\n${colors.bright}${colors.cyan}🦁 Available Tools (${TOOLS.length}):${colors.reset}\n`);
  
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const tools = TOOLS.filter(t => t.category === key);
    if (tools.length === 0) continue;
    
    console.log(`${colors.bright}${cat.emoji} ${cat.name}${colors.reset} ${colors.dim}(${tools.length})${colors.reset}`);
    console.log(`${colors.dim}${'─'.repeat(50)}${colors.reset}`);
    
    for (const tool of tools) {
      console.log(`  ${tool.emoji} ${colors.yellow}${tool.name.padEnd(25)}${colors.reset} ${colors.dim}${tool.description.substring(0, 40)}${colors.reset}`);
    }
    console.log('');
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const hasHelp = args.includes('--help') || args.includes('-h');
  const hasList = args.includes('--list');
  
  if (hasHelp) {
    showHelp();
    process.exit(0);
  }
  
  if (hasList) {
    listTools();
    process.exit(0);
  }
  
  console.error('');
  console.error(`${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.error(`${colors.bright}${colors.cyan}║${colors.reset}  ${colors.bright}${colors.magenta}🦁 Real Browser MCP Server${colors.reset}                                ${colors.cyan}║${colors.reset}`);
  console.error(`${colors.bright}${colors.cyan}║${colors.reset}  ${colors.dim}MCP (AI Agents) Server running on STDIO${colors.reset}                  ${colors.cyan}║${colors.reset}`);
  console.error(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.error('');
  
  console.error(`${colors.bright}${colors.blue}🚀 Starting MCP Server...${colors.reset}`);
  
  // Import and run MCP server
  require('./mcp/index.js');
}

// Export for programmatic use
module.exports = {
  TOOLS,
  TOOL_DISPLAY,
  CATEGORIES,
  startMCP: () => require('./mcp/index.js'),
  startBoth: () => require('./mcp/index.js'),
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(`${colors.red}❌ Fatal error:${colors.reset}`, error.message);
    process.exit(1);
  });
}

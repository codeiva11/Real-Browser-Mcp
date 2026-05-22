/**
 * Brave Real Browser MCP Server - Tool Definitions
 * 
 * Re-exports from shared tools for backward compatibility
 * All tool definitions are now in src/shared/tools.js
 */

const { TOOLS, TOOL_DISPLAY, CATEGORIES, getToolByName, getToolsByCategory, getToolNames, getRequiredParams } = require('../shared/tools');

module.exports = { 
  TOOLS, 
  TOOL_DISPLAY, 
  CATEGORIES,
  getToolByName,
  getToolsByCategory,
  getToolNames,
  getRequiredParams
};

/**
 * AI Module - Main Entry Point
 * 
 * This module provides AI-powered features that automatically enhance
 * ALL tools in the browser automation project.
 * 
 * Features:
 * 1. Smart Element Finding - Find elements using natural language
 * 2. Selector Auto-Healing - Automatically fix broken selectors
 * 3. Page Understanding - Analyze and understand page structure
 * 4. Natural Language Commands - Execute actions from text commands
 * 
 * Usage:
 * ```javascript
 * const { aiCore, smartFind, smartClick, executeCommand } = require('./ai');
 * 
 * // Smart find
 * const elements = await smartFind(page, 'login button');
 * 
 * // Smart click with auto-healing
 * await smartClick(page, '#old-selector');
 * 
 * // Execute natural language command
 * await executeCommand(page, 'click the submit button');
 * ```
 * 
 * Integration with existing tools:
 * All existing handlers can be wrapped with AI capabilities using:
 * ```javascript
 * const enhancedHandler = wrapHandler(originalHandler, 'handlerName');
 * ```
 */

const {
  AICore,
  aiCore,
  smartFind,
  smartClick,
  smartType,
  understandPage,
  executeCommand,
  wrapHandler,
  configure
} = require('./core');

const ElementFinder = require('./element-finder');
const SelectorHealer = require('./selector-healer');
const PageAnalyzer = require('./page-analyzer');
const ActionParser = require('./action-parser');

// Export everything
module.exports = {
  // Main AI Core
  AICore,
  aiCore,
  
  // Quick access functions
  smartFind,
  smartClick,
  smartType,
  understandPage,
  executeCommand,
  wrapHandler,
  configure,
  
  // Individual modules (for advanced usage)
  ElementFinder,
  SelectorHealer,
  PageAnalyzer,
  ActionParser,
  
  // Version info
  version: '1.0.0',
  
  // Feature flags
  features: {
    smartFind: true,
    autoHealing: true,
    pageAnalysis: true,
    naturalLanguage: true
  }
};

/**
 * AI Core Module - Foundation for all AI-powered features
 * 
 * This module provides AI capabilities that are automatically available
 * to ALL tools in the project. Any new tool added will automatically
 * benefit from these AI features.
 * 
 * Features:
 * - Smart element finding with multiple strategies
 * - Auto-healing selectors when they break
 * - Page understanding and structure analysis
 * - Natural language command parsing
 * - Confidence scoring for element matches
 * - Fallback strategies when primary method fails
 */

const ElementFinder = require('./element-finder');
const SelectorHealer = require('./selector-healer');
const PageAnalyzer = require('./page-analyzer');
const ActionParser = require('./action-parser');

/**
 * AI Core class - Central AI intelligence for the browser automation
 */
class AICore {
  constructor() {
    this.elementFinder = new ElementFinder();
    this.selectorHealer = new SelectorHealer();
    this.pageAnalyzer = new PageAnalyzer();
    this.actionParser = new ActionParser();
    
    // Cache for performance
    this.pageCache = new Map();
    this.selectorCache = new Map();
    
    // Configuration
    this.config = {
      defaultConfidence: 0.7,
      maxCacheAge: 30000, // 30 seconds
      enableAutoHeal: true,
      enableSmartFind: true,
      logLevel: 'info' // 'debug' | 'info' | 'warn' | 'error'
    };
  }

  /**
   * Configure AI Core settings
   */
  configure(options = {}) {
    this.config = { ...this.config, ...options };
    return this;
  }

  /**
   * AI-Enhanced element finding
   * Tries multiple strategies to find an element
   */
  async smartFind(page, query, options = {}) {
    const {
      strategy = 'auto',
      context = null,
      confidence = this.config.defaultConfidence,
      returnMultiple = false
    } = options;

    this.log('debug', `SmartFind: "${query}" with strategy: ${strategy}`);

    const results = await this.elementFinder.find(page, query, {
      strategy,
      context,
      confidence,
      returnMultiple
    });

    this.log('info', `SmartFind found ${results.length} elements with confidence >= ${confidence}`);
    
    return results;
  }

  /**
   * AI-Enhanced click with auto-healing
   * If selector fails, tries to find the element using AI
   */
  async smartClick(page, selector, options = {}) {
    const { humanLike = true, autoHeal = this.config.enableAutoHeal } = options;

    try {
      // Try original selector first
      const element = await page.$(selector);
      if (element) {
        if (humanLike) {
          try {
            const { createCursor } = require('ghost-cursor');
            const cursor = createCursor(page);
            await cursor.click(selector);
          } catch {
            await element.click();
          }
        } else {
          await element.click();
        }
        return { success: true, selector, healed: false };
      }
    } catch (e) {
      this.log('warn', `Original selector failed: ${selector}`);
    }

    // Auto-heal if enabled
    if (autoHeal) {
      this.log('info', `Attempting to heal selector: ${selector}`);
      const healed = await this.healAndExecute(page, selector, 'click', options);
      if (healed.success) {
        return { ...healed, healed: true };
      }
    }

    return { success: false, error: `Element not found: ${selector}` };
  }

  /**
   * AI-Enhanced type with auto-healing
   */
  async smartType(page, selector, text, options = {}) {
    const { delay = 50, clear = false, autoHeal = this.config.enableAutoHeal } = options;

    try {
      const element = await page.$(selector);
      if (element) {
        if (clear) {
          await element.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
        }
        await element.type(text, { delay });
        return { success: true, selector, healed: false };
      }
    } catch (e) {
      this.log('warn', `Original selector failed: ${selector}`);
    }

    if (autoHeal) {
      const healed = await this.healAndExecute(page, selector, 'type', { text, ...options });
      if (healed.success) {
        return { ...healed, healed: true };
      }
    }

    return { success: false, error: `Element not found: ${selector}` };
  }

  /**
   * Heal a broken selector and execute action
   */
  async healAndExecute(page, brokenSelector, action, options = {}) {
    const alternatives = await this.selectorHealer.heal(page, brokenSelector, {
      maxAlternatives: 5
    });

    for (const alt of alternatives) {
      try {
        const element = await page.$(alt.selector);
        if (element) {
          this.log('info', `Healed selector: ${brokenSelector} -> ${alt.selector} (confidence: ${alt.confidence})`);
          
          // Cache the healed selector
          this.selectorCache.set(brokenSelector, {
            healed: alt.selector,
            timestamp: Date.now()
          });

          // Execute action
          if (action === 'click') {
            await element.click();
          } else if (action === 'type') {
            if (options.clear) {
              await element.click({ clickCount: 3 });
              await page.keyboard.press('Backspace');
            }
            await element.type(options.text, { delay: options.delay || 50 });
          }

          return { success: true, selector: alt.selector, originalSelector: brokenSelector };
        }
      } catch (e) {
        continue;
      }
    }

    return { success: false, error: 'Could not heal selector' };
  }

  /**
   * Understand page structure
   */
  async understandPage(page, options = {}) {
    const cacheKey = page.url();
    const cached = this.pageCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.config.maxCacheAge) {
      this.log('debug', 'Using cached page analysis');
      return cached.analysis;
    }

    const analysis = await this.pageAnalyzer.analyze(page, options);
    
    this.pageCache.set(cacheKey, {
      analysis,
      timestamp: Date.now()
    });

    return analysis;
  }

  /**
   * Parse natural language command and execute
   */
  async executeCommand(page, command, options = {}) {
    const { context = {}, dryRun = false, humanLike = true } = options;

    this.log('info', `Parsing command: "${command}"`);

    const parsed = await this.actionParser.parse(command, context);

    if (dryRun) {
      return { success: true, dryRun: true, parsed };
    }

    // Execute parsed action
    return await this.executeAction(page, parsed, { humanLike });
  }

  /**
   * Execute a parsed action
   */
  async executeAction(page, action, options = {}) {
    const { humanLike = true } = options;

    switch (action.type) {
      case 'click':
        return await this.smartClick(page, action.target, { humanLike });
      
      case 'type':
        return await this.smartType(page, action.target, action.text, { humanLike });
      
      case 'navigate':
        await page.goto(action.url, { waitUntil: 'networkidle2' });
        return { success: true, url: action.url };
      
      case 'scroll':
        await page.evaluate((direction, amount) => {
          window.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'smooth' });
        }, action.direction || 'down', action.amount || 300);
        return { success: true, direction: action.direction };
      
      case 'wait':
        await new Promise(r => setTimeout(r, action.duration || 1000));
        return { success: true, waited: action.duration };
      
      case 'find':
        const results = await this.smartFind(page, action.query);
        return { success: true, found: results.length, elements: results };
      
      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  }

  /**
   * Wrap any handler with AI capabilities
   * This allows existing handlers to benefit from AI features
   */
  wrapHandler(handler, handlerName) {
    const aiCore = this;
    
    return async function aiEnhancedHandler(params = {}) {
      const startTime = Date.now();
      
      // Check if AI features are requested
      const useAI = params._useAI !== false;
      const autoHeal = params._autoHeal !== false && aiCore.config.enableAutoHeal;
      
      try {
        // Execute original handler
        const result = await handler(params);
        
        // If success, return result
        if (result.success) {
          return {
            ...result,
            _ai: { used: false, duration: Date.now() - startTime }
          };
        }
        
        // If failed and autoHeal is enabled, try AI recovery
        if (autoHeal && result.error?.includes('not found')) {
          aiCore.log('info', `AI attempting recovery for ${handlerName}`);
          
          // Extract selector from params
          const selector = params.selector || params.target;
          if (selector) {
            const healed = await aiCore.selectorHealer.heal(
              params._page,
              selector,
              { maxAlternatives: 3 }
            );
            
            if (healed.length > 0) {
              // Retry with healed selector
              const retryParams = { ...params, selector: healed[0].selector };
              const retryResult = await handler(retryParams);
              
              return {
                ...retryResult,
                _ai: {
                  used: true,
                  healed: true,
                  originalSelector: selector,
                  healedSelector: healed[0].selector,
                  duration: Date.now() - startTime
                }
              };
            }
          }
        }
        
        return {
          ...result,
          _ai: { used: useAI, duration: Date.now() - startTime }
        };
        
      } catch (error) {
        aiCore.log('error', `Handler ${handlerName} failed: ${error.message}`);
        return {
          success: false,
          error: error.message,
          _ai: { used: useAI, duration: Date.now() - startTime }
        };
      }
    };
  }

  /**
   * Clear caches
   */
  clearCache() {
    this.pageCache.clear();
    this.selectorCache.clear();
    this.log('info', 'AI caches cleared');
  }

  /**
   * Logging utility
   */
  log(level, message) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const msgLevel = levels.indexOf(level);
    
    if (msgLevel >= configLevel) {
      const emoji = { debug: '🔍', info: '🤖', warn: '⚠️', error: '❌' }[level];
      console.error(`${emoji} [AI] ${message}`);
    }
  }
}

// Singleton instance
const aiCore = new AICore();

module.exports = {
  AICore,
  aiCore,
  smartFind: (page, query, options) => aiCore.smartFind(page, query, options),
  smartClick: (page, selector, options) => aiCore.smartClick(page, selector, options),
  smartType: (page, selector, text, options) => aiCore.smartType(page, selector, text, options),
  understandPage: (page, options) => aiCore.understandPage(page, options),
  executeCommand: (page, command, options) => aiCore.executeCommand(page, command, options),
  wrapHandler: (handler, name) => aiCore.wrapHandler(handler, name),
  configure: (options) => aiCore.configure(options)
};

/**
 * AI Action Parser - Parse natural language commands into actions
 * 
 * Converts commands like:
 * - "click the login button" -> { type: 'click', target: 'login button' }
 * - "type hello in the search box" -> { type: 'type', target: 'search box', text: 'hello' }
 * - "scroll down" -> { type: 'scroll', direction: 'down' }
 */

class ActionParser {
  constructor() {
    // Action patterns
    this.actionPatterns = [
      // Click patterns
      {
        pattern: /^(click|tap|press|hit|select)\s+(?:on\s+)?(?:the\s+)?(.+)/i,
        type: 'click',
        extract: (match) => ({ target: match[2].trim() })
      },
      // Type patterns
      {
        pattern: /^(type|enter|write|input)\s+["']?([^"']+)["']?\s+(?:in|into|in the|into the)\s+(.+)/i,
        type: 'type',
        extract: (match) => ({ text: match[2].trim(), target: match[3].trim() })
      },
      {
        pattern: /^(type|enter|write|input)\s+(.+)\s+(?:in|into)\s+["']?([^"']+)["']?/i,
        type: 'type',
        extract: (match) => ({ target: match[2].trim(), text: match[3].trim() })
      },
      {
        pattern: /^(fill|fill in|complete)\s+(?:the\s+)?(.+)\s+(?:with|as)\s+["']?([^"']+)["']?/i,
        type: 'type',
        extract: (match) => ({ target: match[2].trim(), text: match[3].trim() })
      },
      // Navigate patterns
      {
        pattern: /^(go to|navigate to|open|visit)\s+(.+)/i,
        type: 'navigate',
        extract: (match) => {
          let url = match[2].trim();
          if (!url.startsWith('http')) {
            url = 'https://' + url;
          }
          return { url };
        }
      },
      // Scroll patterns
      {
        pattern: /^scroll\s+(up|down|left|right)(?:\s+(\d+)\s*(?:px|pixels)?)?/i,
        type: 'scroll',
        extract: (match) => ({ 
          direction: match[1].toLowerCase(), 
          amount: parseInt(match[2]) || 300 
        })
      },
      {
        pattern: /^scroll\s+to\s+(?:the\s+)?(top|bottom|footer|header)/i,
        type: 'scroll',
        extract: (match) => {
          const target = match[1].toLowerCase();
          return {
            direction: target === 'top' || target === 'header' ? 'up' : 'down',
            amount: 10000,
            scrollTo: target
          };
        }
      },
      // Wait patterns
      {
        pattern: /^wait\s+(?:for\s+)?(\d+)\s*(?:ms|milliseconds?|s|seconds?)?/i,
        type: 'wait',
        extract: (match) => {
          let duration = parseInt(match[1]);
          const unit = match[0].toLowerCase();
          if (unit.includes('s') && !unit.includes('ms')) {
            duration *= 1000;
          }
          return { duration };
        }
      },
      {
        pattern: /^wait\s+(?:for\s+)?(?:the\s+)?(.+?)(?:\s+to\s+(?:appear|load|show))?$/i,
        type: 'waitFor',
        extract: (match) => ({ target: match[1].trim() })
      },
      // Find/Search patterns
      {
        pattern: /^(find|search|look for|locate)\s+(?:the\s+)?(.+)/i,
        type: 'find',
        extract: (match) => ({ query: match[2].trim() })
      },
      // Hover patterns
      {
        pattern: /^(hover|mouse over|move to)\s+(?:the\s+)?(.+)/i,
        type: 'hover',
        extract: (match) => ({ target: match[2].trim() })
      },
      // Clear patterns
      {
        pattern: /^(clear|empty|delete)\s+(?:the\s+)?(.+)/i,
        type: 'clear',
        extract: (match) => ({ target: match[2].trim() })
      },
      // Submit patterns
      {
        pattern: /^submit\s+(?:the\s+)?(?:form)?(.*)$/i,
        type: 'submit',
        extract: (match) => ({ target: match[1].trim() || 'form' })
      },
      // Screenshot patterns
      {
        pattern: /^(take|capture)\s+(?:a\s+)?screenshot/i,
        type: 'screenshot',
        extract: () => ({})
      },
      // Go back/forward patterns
      {
        pattern: /^go\s+(back|forward)/i,
        type: 'navigation',
        extract: (match) => ({ direction: match[1].toLowerCase() })
      },
      // Refresh patterns
      {
        pattern: /^(refresh|reload)\s*(?:the\s+)?(?:page)?/i,
        type: 'refresh',
        extract: () => ({})
      }
    ];

    // Context variable patterns (for substitution)
    this.variablePattern = /\{(\w+)\}/g;
  }

  /**
   * Parse a natural language command
   */
  async parse(command, context = {}) {
    // Substitute context variables
    let processedCommand = command.replace(this.variablePattern, (match, varName) => {
      return context[varName] !== undefined ? context[varName] : match;
    });

    // Trim and normalize
    processedCommand = processedCommand.trim();

    // Try each pattern
    for (const pattern of this.actionPatterns) {
      const match = processedCommand.match(pattern.pattern);
      if (match) {
        const extracted = pattern.extract(match);
        return {
          type: pattern.type,
          ...extracted,
          originalCommand: command,
          confidence: 0.9
        };
      }
    }

    // Fallback: Try to guess action from keywords
    const fallback = this.guessFallback(processedCommand);
    if (fallback) {
      return {
        ...fallback,
        originalCommand: command,
        confidence: 0.5
      };
    }

    // Could not parse
    return {
      type: 'unknown',
      originalCommand: command,
      confidence: 0,
      error: 'Could not understand command'
    };
  }

  /**
   * Try to guess action from keywords
   */
  guessFallback(command) {
    const lower = command.toLowerCase();

    // Check for action keywords
    if (lower.includes('button') || lower.includes('link') || lower.includes('click')) {
      return { type: 'click', target: command };
    }

    if (lower.includes('type') || lower.includes('enter') || lower.includes('input')) {
      return { type: 'find', query: command, suggestedAction: 'type' };
    }

    if (lower.includes('search') || lower.includes('find') || lower.includes('look')) {
      return { type: 'find', query: command };
    }

    if (lower.includes('scroll')) {
      return { type: 'scroll', direction: 'down', amount: 300 };
    }

    // Default to find
    return { type: 'find', query: command };
  }

  /**
   * Parse multiple commands (separated by 'then', 'and', or newlines)
   */
  async parseMultiple(commands, context = {}) {
    // Split by separators
    const parts = commands.split(/\s+(?:then|and)\s+|\n|;/i).filter(p => p.trim());
    
    const results = [];
    for (const part of parts) {
      const parsed = await this.parse(part.trim(), context);
      results.push(parsed);
    }

    return results;
  }

  /**
   * Get suggestions for incomplete commands
   */
  getSuggestions(partialCommand) {
    const lower = partialCommand.toLowerCase();
    const suggestions = [];

    if (lower.startsWith('click')) {
      suggestions.push(
        'click the login button',
        'click the submit button',
        'click the link',
        'click the menu'
      );
    } else if (lower.startsWith('type')) {
      suggestions.push(
        'type "text" in the search box',
        'type "username" in the login field',
        'type "hello" in the input'
      );
    } else if (lower.startsWith('go')) {
      suggestions.push(
        'go to google.com',
        'go back',
        'go forward'
      );
    } else if (lower.startsWith('scroll')) {
      suggestions.push(
        'scroll down',
        'scroll up',
        'scroll to the bottom',
        'scroll to the top'
      );
    } else if (lower.startsWith('wait')) {
      suggestions.push(
        'wait 2 seconds',
        'wait for the button to appear',
        'wait 500ms'
      );
    } else if (lower.startsWith('find')) {
      suggestions.push(
        'find the login button',
        'find the search input',
        'find all links'
      );
    }

    return suggestions;
  }
}

module.exports = ActionParser;

/**
 * AI Element Finder - Smart element finding with multiple strategies
 * 
 * Strategies:
 * - text: Find by visible text content
 * - aria: Find by accessibility attributes (aria-label, role, etc.)
 * - visual: Find by position, size, color context
 * - semantic: Find by HTML structure and semantic meaning
 * - auto: Try all strategies and return best matches
 */

class ElementFinder {
  constructor() {
    // Common element patterns for different types
    this.patterns = {
      button: {
        tags: ['button', 'input[type="button"]', 'input[type="submit"]', 'a.btn', '[role="button"]'],
        keywords: ['click', 'submit', 'button', 'btn', 'press']
      },
      input: {
        tags: ['input', 'textarea', '[contenteditable="true"]'],
        keywords: ['input', 'field', 'textbox', 'enter', 'type', 'write']
      },
      link: {
        tags: ['a[href]', '[role="link"]'],
        keywords: ['link', 'go to', 'navigate', 'open']
      },
      search: {
        tags: ['input[type="search"]', 'input[name*="search"]', 'input[placeholder*="search"]', '[role="searchbox"]'],
        keywords: ['search', 'find', 'lookup', 'query']
      },
      login: {
        tags: ['input[type="password"]', 'input[name*="password"]', 'input[name*="login"]', 'input[name*="user"]'],
        keywords: ['login', 'password', 'username', 'email', 'signin', 'sign in']
      },
      form: {
        tags: ['form', '[role="form"]'],
        keywords: ['form', 'submit']
      },
      menu: {
        tags: ['nav', '[role="navigation"]', '[role="menu"]', 'ul.menu', '.nav'],
        keywords: ['menu', 'navigation', 'nav']
      },
      image: {
        tags: ['img', 'picture', '[role="img"]', 'svg'],
        keywords: ['image', 'picture', 'photo', 'icon', 'logo']
      },
      video: {
        tags: ['video', 'iframe[src*="youtube"]', 'iframe[src*="vimeo"]', '[role="video"]'],
        keywords: ['video', 'player', 'watch']
      }
    };

    // Common action keywords
    this.actionKeywords = {
      click: ['click', 'press', 'tap', 'hit', 'select', 'choose'],
      type: ['type', 'enter', 'write', 'input', 'fill'],
      scroll: ['scroll', 'move', 'go down', 'go up'],
      hover: ['hover', 'mouse over', 'point'],
      wait: ['wait', 'pause', 'delay']
    };
  }

  /**
   * Find elements matching the query
   */
  async find(page, query, options = {}) {
    const {
      strategy = 'auto',
      context = null,
      confidence = 0.7,
      returnMultiple = false
    } = options;

    let results = [];

    // Parse query to understand what user is looking for
    const parsedQuery = this.parseQuery(query);

    // Apply different strategies
    if (strategy === 'auto' || strategy === 'text') {
      const textResults = await this.findByText(page, parsedQuery, context);
      results = [...results, ...textResults];
    }

    if (strategy === 'auto' || strategy === 'aria') {
      const ariaResults = await this.findByAria(page, parsedQuery, context);
      results = [...results, ...ariaResults];
    }

    if (strategy === 'auto' || strategy === 'semantic') {
      const semanticResults = await this.findBySemantic(page, parsedQuery, context);
      results = [...results, ...semanticResults];
    }

    if (strategy === 'auto' || strategy === 'visual') {
      const visualResults = await this.findByVisual(page, parsedQuery, context);
      results = [...results, ...visualResults];
    }

    // Deduplicate and sort by confidence
    results = this.deduplicateResults(results);
    results.sort((a, b) => b.confidence - a.confidence);

    // Filter by confidence threshold
    results = results.filter(r => r.confidence >= confidence);

    return returnMultiple ? results : results.slice(0, 1);
  }

  /**
   * Parse natural language query
   */
  parseQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    // Detect element type
    let elementType = 'any';
    for (const [type, pattern] of Object.entries(this.patterns)) {
      if (pattern.keywords.some(kw => lowerQuery.includes(kw))) {
        elementType = type;
        break;
      }
    }

    // Extract key terms
    const terms = query.split(/\s+/).filter(t => t.length > 2);
    
    // Detect if looking for specific text
    const textMatch = query.match(/["']([^"']+)["']|containing\s+(.+)|with text\s+(.+)|labeled\s+(.+)/i);
    const targetText = textMatch ? (textMatch[1] || textMatch[2] || textMatch[3] || textMatch[4]) : null;

    // Detect color mentions
    const colorMatch = query.match(/\b(red|blue|green|yellow|orange|purple|black|white|gray|grey)\b/i);
    const color = colorMatch ? colorMatch[1].toLowerCase() : null;

    // Detect position mentions
    const positionMatch = query.match(/\b(top|bottom|left|right|center|first|last|header|footer)\b/i);
    const position = positionMatch ? positionMatch[1].toLowerCase() : null;

    return {
      original: query,
      elementType,
      terms,
      targetText,
      color,
      position
    };
  }

  /**
   * Find by text content
   */
  async findByText(page, parsedQuery, context) {
    const contextSelector = context || 'body';
    
    return await page.evaluate(({ parsedQuery, contextSelector }) => {
      const results = [];
      const container = document.querySelector(contextSelector) || document.body;
      
      // Get all interactive and text-containing elements
      const elements = container.querySelectorAll('button, a, input, label, span, div, p, h1, h2, h3, h4, h5, h6, [role]');
      
      for (const el of elements) {
        const text = el.textContent?.trim().toLowerCase() || '';
        const placeholder = el.placeholder?.toLowerCase() || '';
        const value = el.value?.toLowerCase() || '';
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
        
        let confidence = 0;
        const matchedTerms = [];
        
        // Check each search term
        for (const term of parsedQuery.terms) {
          const lowerTerm = term.toLowerCase();
          
          if (text.includes(lowerTerm)) {
            confidence += 0.3;
            matchedTerms.push({ term, in: 'text' });
          }
          if (placeholder.includes(lowerTerm)) {
            confidence += 0.25;
            matchedTerms.push({ term, in: 'placeholder' });
          }
          if (ariaLabel.includes(lowerTerm)) {
            confidence += 0.25;
            matchedTerms.push({ term, in: 'aria-label' });
          }
        }
        
        // Exact text match bonus
        if (parsedQuery.targetText && text.includes(parsedQuery.targetText.toLowerCase())) {
          confidence += 0.4;
        }
        
        // Visibility bonus
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          confidence += 0.1;
        }
        
        if (confidence > 0) {
          // Generate selector
          let selector = '';
          if (el.id) {
            selector = `#${el.id}`;
          } else if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(' ').filter(c => c).slice(0, 2).join('.');
            selector = `${el.tagName.toLowerCase()}.${classes}`;
          } else {
            selector = el.tagName.toLowerCase();
            if (el.getAttribute('type')) {
              selector += `[type="${el.getAttribute('type')}"]`;
            }
          }
          
          results.push({
            selector,
            confidence: Math.min(confidence, 1),
            text: text.substring(0, 100),
            strategy: 'text',
            matchedTerms,
            tag: el.tagName.toLowerCase(),
            visible: rect.width > 0 && rect.height > 0
          });
        }
      }
      
      return results;
    }, { parsedQuery, contextSelector });
  }

  /**
   * Find by ARIA attributes
   */
  async findByAria(page, parsedQuery, context) {
    const contextSelector = context || 'body';
    
    return await page.evaluate(({ parsedQuery, contextSelector }) => {
      const results = [];
      const container = document.querySelector(contextSelector) || document.body;
      
      // Find elements with ARIA attributes
      const ariaElements = container.querySelectorAll('[aria-label], [aria-describedby], [role], [aria-placeholder]');
      
      for (const el of ariaElements) {
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
        const role = el.getAttribute('role')?.toLowerCase() || '';
        const ariaPlaceholder = el.getAttribute('aria-placeholder')?.toLowerCase() || '';
        
        let confidence = 0;
        
        for (const term of parsedQuery.terms) {
          const lowerTerm = term.toLowerCase();
          
          if (ariaLabel.includes(lowerTerm)) {
            confidence += 0.35;
          }
          if (role.includes(lowerTerm)) {
            confidence += 0.2;
          }
          if (ariaPlaceholder.includes(lowerTerm)) {
            confidence += 0.25;
          }
        }
        
        // Role matching for element type
        if (parsedQuery.elementType !== 'any') {
          if (role === parsedQuery.elementType || 
              role === 'button' && parsedQuery.elementType === 'button') {
            confidence += 0.2;
          }
        }
        
        if (confidence > 0) {
          let selector = '';
          if (el.getAttribute('aria-label')) {
            selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
          } else if (el.id) {
            selector = `#${el.id}`;
          } else {
            selector = `[role="${role}"]`;
          }
          
          const rect = el.getBoundingClientRect();
          
          results.push({
            selector,
            confidence: Math.min(confidence, 1),
            ariaLabel,
            role,
            strategy: 'aria',
            tag: el.tagName.toLowerCase(),
            visible: rect.width > 0 && rect.height > 0
          });
        }
      }
      
      return results;
    }, { parsedQuery, contextSelector });
  }

  /**
   * Find by semantic HTML structure
   */
  async findBySemantic(page, parsedQuery, context) {
    const contextSelector = context || 'body';
    const patterns = this.patterns;
    
    return await page.evaluate(({ parsedQuery, contextSelector, patterns }) => {
      const results = [];
      const container = document.querySelector(contextSelector) || document.body;
      
      // Get pattern for element type
      const pattern = patterns[parsedQuery.elementType];
      
      if (pattern) {
        for (const tagSelector of pattern.tags) {
          const elements = container.querySelectorAll(tagSelector);
          
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            let confidence = 0.5; // Base confidence for matching pattern
            
            // Check text content matches
            const text = el.textContent?.toLowerCase() || '';
            for (const term of parsedQuery.terms) {
              if (text.includes(term.toLowerCase())) {
                confidence += 0.2;
              }
            }
            
            // Generate unique selector
            let selector = '';
            if (el.id) {
              selector = `#${el.id}`;
              confidence += 0.1;
            } else if (el.name) {
              selector = `[name="${el.name}"]`;
              confidence += 0.1;
            } else {
              selector = tagSelector;
            }
            
            results.push({
              selector,
              confidence: Math.min(confidence, 1),
              text: text.substring(0, 50),
              strategy: 'semantic',
              elementType: parsedQuery.elementType,
              tag: el.tagName.toLowerCase(),
              visible: true
            });
          }
        }
      }
      
      return results;
    }, { parsedQuery, contextSelector, patterns });
  }

  /**
   * Find by visual properties (position, approximate area)
   */
  async findByVisual(page, parsedQuery, context) {
    const contextSelector = context || 'body';
    
    return await page.evaluate(({ parsedQuery, contextSelector }) => {
      const results = [];
      const container = document.querySelector(contextSelector) || document.body;
      
      // Get viewport dimensions
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      const elements = container.querySelectorAll('button, a, input, [role="button"], [role="link"]');
      
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        
        let confidence = 0.3; // Base confidence
        
        // Position matching
        if (parsedQuery.position) {
          const pos = parsedQuery.position;
          
          if (pos === 'top' && rect.top < viewportHeight * 0.3) {
            confidence += 0.3;
          } else if (pos === 'bottom' && rect.bottom > viewportHeight * 0.7) {
            confidence += 0.3;
          } else if (pos === 'left' && rect.left < viewportWidth * 0.3) {
            confidence += 0.3;
          } else if (pos === 'right' && rect.right > viewportWidth * 0.7) {
            confidence += 0.3;
          } else if (pos === 'center' && 
                     rect.left > viewportWidth * 0.3 && 
                     rect.right < viewportWidth * 0.7) {
            confidence += 0.3;
          } else if (pos === 'header' && rect.top < 100) {
            confidence += 0.3;
          } else if (pos === 'footer' && rect.bottom > viewportHeight - 100) {
            confidence += 0.3;
          }
        }
        
        // Check text content
        const text = el.textContent?.toLowerCase() || '';
        for (const term of parsedQuery.terms) {
          if (text.includes(term.toLowerCase())) {
            confidence += 0.2;
          }
        }
        
        if (confidence > 0.3) {
          let selector = '';
          if (el.id) {
            selector = `#${el.id}`;
          } else {
            selector = el.tagName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
              selector += '.' + el.className.split(' ')[0];
            }
          }
          
          results.push({
            selector,
            confidence: Math.min(confidence, 1),
            text: text.substring(0, 50),
            strategy: 'visual',
            position: {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            tag: el.tagName.toLowerCase(),
            visible: true
          });
        }
      }
      
      return results;
    }, { parsedQuery, contextSelector });
  }

  /**
   * Deduplicate results based on selector
   */
  deduplicateResults(results) {
    const seen = new Map();
    
    for (const result of results) {
      const existing = seen.get(result.selector);
      if (!existing || existing.confidence < result.confidence) {
        seen.set(result.selector, result);
      }
    }
    
    return Array.from(seen.values());
  }
}

module.exports = ElementFinder;

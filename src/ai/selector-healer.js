/**
 * AI Selector Healer - Auto-fix broken CSS selectors
 * 
 * When a selector stops working (page updated, dynamic content, etc.),
 * this module tries to find alternative selectors that match the same element.
 */

class SelectorHealer {
  constructor() {
    this.healingStrategies = [
      'byId',
      'byName', 
      'byAriaLabel',
      'byText',
      'byClasses',
      'byAttributes',
      'byStructure',
      'byPosition'
    ];
  }

  /**
   * Heal a broken selector by finding alternatives
   */
  async heal(page, brokenSelector, options = {}) {
    const {
      lastKnownText = null,
      lastKnownAttributes = {},
      elementType = null,
      maxAlternatives = 5
    } = options;

    const context = {
      brokenSelector,
      lastKnownText,
      lastKnownAttributes,
      elementType
    };

    // Try to extract info from broken selector
    const selectorInfo = this.parseSelector(brokenSelector);
    
    // Find alternatives using multiple strategies
    const alternatives = await page.evaluate(({ context, selectorInfo }) => {
      const results = [];
      
      // Strategy 1: Find by similar ID
      if (selectorInfo.id) {
        const elements = document.querySelectorAll(`[id*="${selectorInfo.id}"]`);
        for (const el of elements) {
          results.push({
            selector: `#${el.id}`,
            confidence: 0.9,
            strategy: 'byId',
            reason: 'Similar ID found'
          });
        }
      }
      
      // Strategy 2: Find by name attribute
      if (selectorInfo.name) {
        const elements = document.querySelectorAll(`[name*="${selectorInfo.name}"]`);
        for (const el of elements) {
          results.push({
            selector: `[name="${el.name}"]`,
            confidence: 0.85,
            strategy: 'byName',
            reason: 'Similar name attribute found'
          });
        }
      }
      
      // Strategy 3: Find by last known text
      if (context.lastKnownText) {
        const allElements = document.querySelectorAll('button, a, input, label, span, div, [role]');
        for (const el of allElements) {
          const text = el.textContent?.trim();
          if (text && text.toLowerCase().includes(context.lastKnownText.toLowerCase())) {
            let selector = '';
            if (el.id) {
              selector = `#${el.id}`;
            } else if (el.className) {
              selector = `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}`;
            } else {
              selector = `${el.tagName.toLowerCase()}`;
            }
            
            results.push({
              selector,
              confidence: 0.8,
              strategy: 'byText',
              reason: `Contains text: "${text.substring(0, 30)}"`
            });
          }
        }
      }
      
      // Strategy 4: Find by similar classes
      if (selectorInfo.classes.length > 0) {
        for (const cls of selectorInfo.classes) {
          const elements = document.querySelectorAll(`[class*="${cls}"]`);
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({
                selector: `.${cls}`,
                confidence: 0.7,
                strategy: 'byClasses',
                reason: `Similar class: ${cls}`
              });
            }
          }
        }
      }
      
      // Strategy 5: Find by tag and type
      if (selectorInfo.tag) {
        let selector = selectorInfo.tag;
        if (selectorInfo.type) {
          selector += `[type="${selectorInfo.type}"]`;
        }
        
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            let uniqueSelector = selector;
            if (el.placeholder) {
              uniqueSelector += `[placeholder="${el.placeholder}"]`;
            } else if (el.value) {
              uniqueSelector += `[value="${el.value}"]`;
            }
            
            results.push({
              selector: uniqueSelector,
              confidence: 0.6,
              strategy: 'byAttributes',
              reason: `Similar element structure`
            });
          }
        }
      }
      
      // Strategy 6: Find by aria-label
      if (context.lastKnownAttributes?.['aria-label']) {
        const label = context.lastKnownAttributes['aria-label'];
        const elements = document.querySelectorAll(`[aria-label*="${label}"]`);
        for (const el of elements) {
          results.push({
            selector: `[aria-label="${el.getAttribute('aria-label')}"]`,
            confidence: 0.85,
            strategy: 'byAriaLabel',
            reason: 'Similar aria-label found'
          });
        }
      }
      
      // Deduplicate
      const seen = new Set();
      return results.filter(r => {
        if (seen.has(r.selector)) return false;
        seen.add(r.selector);
        return true;
      });
      
    }, { context, selectorInfo });

    // Sort by confidence and return top alternatives
    return alternatives
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxAlternatives);
  }

  /**
   * Parse a CSS selector to extract components
   */
  parseSelector(selector) {
    const info = {
      tag: null,
      id: null,
      classes: [],
      name: null,
      type: null,
      attributes: {}
    };

    // Extract ID
    const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) info.id = idMatch[1];

    // Extract classes
    const classMatches = selector.matchAll(/\.([a-zA-Z0-9_-]+)/g);
    for (const match of classMatches) {
      info.classes.push(match[1]);
    }

    // Extract tag
    const tagMatch = selector.match(/^([a-zA-Z]+)/);
    if (tagMatch) info.tag = tagMatch[1];

    // Extract attributes
    const attrMatches = selector.matchAll(/\[([a-zA-Z-]+)(?:=["']?([^"'\]]+)["']?)?\]/g);
    for (const match of attrMatches) {
      const key = match[1];
      const value = match[2] || true;
      info.attributes[key] = value;
      
      if (key === 'name') info.name = value;
      if (key === 'type') info.type = value;
    }

    return info;
  }

  /**
   * Test if a selector works
   */
  async testSelector(page, selector) {
    try {
      const element = await page.$(selector);
      if (!element) return { valid: false };
      
      const info = await element.evaluate(el => ({
        visible: el.offsetWidth > 0 && el.offsetHeight > 0,
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.substring(0, 50)
      }));
      
      return { valid: true, ...info };
    } catch {
      return { valid: false };
    }
  }
}

module.exports = SelectorHealer;

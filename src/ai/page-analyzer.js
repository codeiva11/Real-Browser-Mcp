/**
 * AI Page Analyzer - Understand page structure and content
 * 
 * Analyzes page to identify:
 * - Interactive elements (buttons, links, inputs)
 * - Forms and form fields
 * - Navigation structure
 * - Main content areas
 * - Media elements
 */

class PageAnalyzer {
  constructor() {
    this.analysisTypes = ['full', 'interactive', 'forms', 'navigation', 'content', 'media'];
  }

  /**
   * Analyze page structure
   */
  async analyze(page, options = {}) {
    const {
      analysisType = 'full',
      includeSelectors = true,
      includeScreenshot = false,
      maxDepth = 10
    } = options;

    const analysis = await page.evaluate(({ analysisType, includeSelectors, maxDepth }) => {
      const result = {
        url: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      };

      // Helper to generate selector
      const getSelector = (el) => {
        if (!includeSelectors) return null;
        if (el.id) return `#${el.id}`;
        if (el.name) return `[name="${el.name}"]`;
        if (el.className && typeof el.className === 'string') {
          const cls = el.className.split(' ').filter(c => c)[0];
          if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
        }
        return el.tagName.toLowerCase();
      };

      // Analyze interactive elements
      if (analysisType === 'full' || analysisType === 'interactive') {
        result.interactive = {
          buttons: [],
          links: [],
          inputs: []
        };

        // Buttons
        document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            result.interactive.buttons.push({
              selector: getSelector(el),
              text: el.textContent?.trim().substring(0, 50),
              type: el.type || 'button',
              disabled: el.disabled,
              visible: true
            });
          }
        });

        // Links
        document.querySelectorAll('a[href]').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            result.interactive.links.push({
              selector: getSelector(el),
              text: el.textContent?.trim().substring(0, 50),
              href: el.href,
              target: el.target || '_self',
              visible: true
            });
          }
        });

        // Inputs
        document.querySelectorAll('input, textarea, select').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            result.interactive.inputs.push({
              selector: getSelector(el),
              type: el.type || 'text',
              name: el.name,
              placeholder: el.placeholder,
              required: el.required,
              disabled: el.disabled,
              value: el.type === 'password' ? '***' : el.value?.substring(0, 20),
              visible: true
            });
          }
        });
      }

      // Analyze forms
      if (analysisType === 'full' || analysisType === 'forms') {
        result.forms = [];
        
        document.querySelectorAll('form').forEach(form => {
          const formData = {
            selector: getSelector(form),
            action: form.action,
            method: form.method,
            fields: []
          };

          form.querySelectorAll('input, textarea, select').forEach(field => {
            formData.fields.push({
              selector: getSelector(field),
              type: field.type || field.tagName.toLowerCase(),
              name: field.name,
              label: document.querySelector(`label[for="${field.id}"]`)?.textContent?.trim(),
              required: field.required,
              placeholder: field.placeholder
            });
          });

          // Find submit button
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
          if (submitBtn) {
            formData.submitButton = {
              selector: getSelector(submitBtn),
              text: submitBtn.textContent?.trim() || submitBtn.value
            };
          }

          result.forms.push(formData);
        });
      }

      // Analyze navigation
      if (analysisType === 'full' || analysisType === 'navigation') {
        result.navigation = {
          menus: [],
          breadcrumbs: null,
          pagination: null
        };

        // Find menus
        document.querySelectorAll('nav, [role="navigation"], .nav, .menu, header ul').forEach(nav => {
          const links = [];
          nav.querySelectorAll('a').forEach(a => {
            links.push({
              text: a.textContent?.trim().substring(0, 30),
              href: a.href,
              selector: getSelector(a)
            });
          });

          if (links.length > 0) {
            result.navigation.menus.push({
              selector: getSelector(nav),
              type: nav.tagName.toLowerCase(),
              links: links.slice(0, 20)
            });
          }
        });

        // Find breadcrumbs
        const breadcrumb = document.querySelector('[aria-label*="breadcrumb"], .breadcrumb, .breadcrumbs');
        if (breadcrumb) {
          result.navigation.breadcrumbs = {
            selector: getSelector(breadcrumb),
            items: Array.from(breadcrumb.querySelectorAll('a, span')).map(el => el.textContent?.trim()).filter(Boolean)
          };
        }

        // Find pagination
        const pagination = document.querySelector('.pagination, [aria-label*="pagination"], nav[role="navigation"] a[href*="page"]');
        if (pagination) {
          result.navigation.pagination = {
            selector: getSelector(pagination.closest('nav, .pagination, div')),
            found: true
          };
        }
      }

      // Analyze main content
      if (analysisType === 'full' || analysisType === 'content') {
        result.content = {
          headings: [],
          paragraphs: 0,
          mainContent: null
        };

        // Headings
        document.querySelectorAll('h1, h2, h3').forEach(h => {
          result.content.headings.push({
            level: parseInt(h.tagName[1]),
            text: h.textContent?.trim().substring(0, 100),
            selector: getSelector(h)
          });
        });

        // Count paragraphs
        result.content.paragraphs = document.querySelectorAll('p').length;

        // Find main content area
        const main = document.querySelector('main, [role="main"], article, .content, #content');
        if (main) {
          result.content.mainContent = {
            selector: getSelector(main),
            textLength: main.textContent?.length || 0
          };
        }
      }

      // Analyze media
      if (analysisType === 'full' || analysisType === 'media') {
        result.media = {
          images: [],
          videos: [],
          iframes: []
        };

        // Images
        document.querySelectorAll('img').forEach(img => {
          const rect = img.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 50) {
            result.media.images.push({
              selector: getSelector(img),
              src: img.src?.substring(0, 100),
              alt: img.alt,
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
          }
        });

        // Videos
        document.querySelectorAll('video').forEach(video => {
          result.media.videos.push({
            selector: getSelector(video),
            src: video.src || video.querySelector('source')?.src,
            duration: video.duration,
            controls: video.controls
          });
        });

        // Iframes (potential embedded content)
        document.querySelectorAll('iframe').forEach(iframe => {
          result.media.iframes.push({
            selector: getSelector(iframe),
            src: iframe.src?.substring(0, 100),
            title: iframe.title
          });
        });
      }

      // Summary stats
      result.summary = {
        totalButtons: result.interactive?.buttons?.length || 0,
        totalLinks: result.interactive?.links?.length || 0,
        totalInputs: result.interactive?.inputs?.length || 0,
        totalForms: result.forms?.length || 0,
        totalImages: result.media?.images?.length || 0,
        hasNavigation: (result.navigation?.menus?.length || 0) > 0,
        isLoginPage: !!(result.interactive?.inputs?.find(i => i.type === 'password')),
        isSearchPage: !!(result.interactive?.inputs?.find(i => i.type === 'search' || i.name?.includes('search') || i.placeholder?.toLowerCase().includes('search')))
      };

      return result;
    }, { analysisType, includeSelectors, maxDepth });

    // Add screenshot if requested
    if (includeScreenshot) {
      const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
      analysis.screenshot = screenshot;
    }

    return analysis;
  }

  /**
   * Get quick summary of page
   */
  async quickSummary(page) {
    return await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        buttons: document.querySelectorAll('button, [role="button"]').length,
        links: document.querySelectorAll('a[href]').length,
        inputs: document.querySelectorAll('input, textarea').length,
        forms: document.querySelectorAll('form').length,
        images: document.querySelectorAll('img').length,
        hasLogin: !!document.querySelector('input[type="password"]'),
        hasSearch: !!document.querySelector('input[type="search"], [name*="search"], [placeholder*="earch"]')
      };
    });
  }
}

module.exports = PageAnalyzer;

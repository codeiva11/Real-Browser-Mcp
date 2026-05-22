/**
 * Brave Real Browser MCP Server - Tool Handlers
 * 
 * Implementation of all 23 browser automation tools (optimized from 28)
 * 
 * Environment Variables:
 *   HEADLESS=true   - Run browser in headless mode
 *   HEADLESS=false  - Run browser in GUI mode (visible)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');


// Browser state management
let browserInstance = null;
let pageInstance = null;
let blockerInstance = null;
let setupPageFn = null; // CDP early injection function
let networkRecords = [];
let isRecordingNetwork = false;
let progressTasks = {};

// Progress notification callback (set by server)
let progressCallback = null;

/**
 * Set progress callback for real-time notifications
 */
function setProgressCallback(callback) {
  progressCallback = callback;
}

/**
 * Send real-time progress notification
 */
function notifyProgress(toolName, status, message, data = {}) {
  const notification = {
    tool: toolName,
    status, // 'started' | 'progress' | 'completed' | 'error'
    message,
    timestamp: new Date().toISOString(),
    ...data
  };

  // Log to stderr for visibility
  const emoji = {
    started: '🚀',
    progress: '⏳',
    completed: '✅',
    error: '❌'
  }[status] || '📌';

  console.error(`${emoji} [${toolName}] ${message}`);

  // Call progress callback if set
  if (progressCallback) {
    progressCallback(notification);
  }

  return notification;
}

/**
 * Get headless setting from environment
 */
function getHeadlessFromEnv() {
  const envHeadless = process.env.HEADLESS;

  if (envHeadless !== undefined && envHeadless !== null && envHeadless !== '') {
    const value = envHeadless.toLowerCase().trim();
    return value === 'true' || value === '1' || value === 'yes';
  }

  // Auto-detect CI environments
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.TRAVIS || process.env.CIRCLECI) {
    return true;
  }

  // Auto-detect headless Linux environments without X11 or Wayland
  if (process.platform === 'linux') {
    const hasDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
    if (!hasDisplay) {
      return true;
    }
  }

  return false;
}

/**
 * Get browser and page instances
 */
function getState() {
  return { browser: browserInstance, page: pageInstance, blocker: blockerInstance };
}

/**
 * Check if browser is initialized
 */
function requireBrowser() {
  if (!browserInstance || !pageInstance) {
    throw new Error('Browser not initialized. Call browser_init first.');
  }
  return { browser: browserInstance, page: pageInstance };
}

/**
 * DECODER UTILITIES - URL, Base64, AES Decryption
 */
const decoders = {
  // URL Decoder
  urlDecode: (encodedUrl) => {
    try {
      // Handle multiple encoding layers
      let decoded = encodedUrl;
      let iterations = 0;
      const maxIterations = 5;

      while (iterations < maxIterations) {
        const newDecoded = decodeURIComponent(decoded);
        if (newDecoded === decoded) break;
        decoded = newDecoded;
        iterations++;
      }

      return { success: true, decoded, iterations, original: encodedUrl };
    } catch (error) {
      return { success: false, error: error.message, original: encodedUrl };
    }
  },

  // Base64 Decoder
  base64Decode: (encodedData) => {
    try {
      // Try multiple approaches
      const approaches = [];

      // Standard Base64
      try {
        const decoded = Buffer.from(encodedData, 'base64').toString('utf-8');
        if (decoded && decoded !== encodedData) {
          approaches.push({ method: 'standard', decoded });
        }
      } catch (e) { }

      // URL-safe Base64 (replace - with +, _ with /)
      try {
        const normalized = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(normalized, 'base64').toString('utf-8');
        if (decoded && decoded !== encodedData) {
          approaches.push({ method: 'url-safe', decoded });
        }
      } catch (e) { }

      // With padding
      try {
        const padding = 4 - (encodedData.length % 4);
        if (padding !== 4) {
          const padded = encodedData + '='.repeat(padding);
          const decoded = Buffer.from(padded, 'base64').toString('utf-8');
          if (decoded && decoded !== encodedData) {
            approaches.push({ method: 'padded', decoded });
          }
        }
      } catch (e) { }

      if (approaches.length === 0) {
        return { success: false, error: 'Could not decode base64', original: encodedData };
      }

      return { success: true, decoded: approaches[0].decoded, approaches, original: encodedData };
    } catch (error) {
      return { success: false, error: error.message, original: encodedData };
    }
  },

  // AES Decryptor
  decryptAES: (encryptedData, key, iv = null, algorithm = 'aes-256-cbc') => {
    try {
      // Convert inputs to buffers if needed
      const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf-8');

      // Handle different input formats
      let encryptedBuffer;
      if (Buffer.isBuffer(encryptedData)) {
        encryptedBuffer = encryptedData;
      } else if (encryptedData.includes('%')) {
        // URL encoded
        encryptedBuffer = Buffer.from(decodeURIComponent(encryptedData), 'base64');
      } else {
        encryptedBuffer = Buffer.from(encryptedData, 'base64');
      }

      let decipher;
      if (iv) {
        const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'utf-8');
        decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);
      } else {
        // Try without IV (ECB mode - less secure but sometimes used)
        decipher = crypto.createDecipheriv(algorithm.replace('-cbc', '-ecb'), keyBuffer, Buffer.alloc(0));
      }

      let decrypted = decipher.update(encryptedBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      const result = decrypted.toString('utf-8');
      return { success: true, decrypted: result, algorithm };
    } catch (error) {
      return { success: false, error: error.message, algorithm };
    }
  },

  // Try all decoders
  tryAll: (data, options = {}) => {
    const results = {
      original: data,
      attempts: []
    };

    // Try URL decode
    const urlResult = decoders.urlDecode(data);
    if (urlResult.success && urlResult.iterations > 0) {
      results.attempts.push({ type: 'url', result: urlResult.decoded });
    }

    // Try Base64
    const base64Result = decoders.base64Decode(data);
    if (base64Result.success) {
      results.attempts.push({ type: 'base64', result: base64Result.decoded });

      // Try nested decoding
      const nestedUrl = decoders.urlDecode(base64Result.decoded);
      if (nestedUrl.success && nestedUrl.iterations > 0) {
        results.attempts.push({ type: 'base64+url', result: nestedUrl.decoded });
      }
    }

    // Try AES if key provided
    if (options.key) {
      const aesResult = decoders.decryptAES(data, options.key, options.iv, options.algorithm);
      if (aesResult.success) {
        results.attempts.push({ type: 'aes', result: aesResult.decrypted });
      }
    }

    return results;
  }
};

/**
 * Tool Handlers Object
 */
const handlers = {
  // ═══════════════════════════════════════════════════════════════
  // HELPER: Auto-Close Blocking Modals/Popups
  // ═══════════════════════════════════════════════════════════════
  async _handleBlockingModals(page) {
    try {
      const closed = await page.evaluate(() => {
        // Selectors for common modal close buttons
        const closeSelectors = [
          // Bootstrap/Standard Modals
          '.modal.show .btn-close',
          '.modal.show .close',
          '.modal.in .close',
          '.modal-footer .btn-primary', // "OK" button usually
          '.modal-footer .btn-secondary', // "Close" button
          // Custom Overlays
          '#modal-close',
          '.popup-close',
          '.overlay-close',
          // Generic "X" buttons in overlays
          'div[role="dialog"] button[aria-label="Close"]',
          'div[role="dialog"] .close',
          // SweetAlert / specific libraries
          '.swal2-confirm',
          '.swal2-cancel',
          '.ui-dialog-titlebar-close',
          // eCourts specific if known (generic fallback)
          '.modal-header .close',
          'button[data-dismiss="modal"]'
        ];

        let clicked = false;
        // Check if any modal is visible (display block/flex and opacity > 0)
        const modals = document.querySelectorAll('.modal, .popup, .overlay, .dialog, [role="dialog"]');
        for (const modal of modals) {
          const style = window.getComputedStyle(modal);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            // Modal is visible, find a close button inside
            for (const selector of closeSelectors) {
              const btn = modal.querySelector(selector);
              if (btn && btn.offsetParent !== null) { // Visible button
                btn.click();
                clicked = true;
                break; // Clicked one, break inner loop
              }
            }
            if (clicked) break; // Handled one modal, break outer loop
          }
        }
        return clicked;
      });

      if (closed) {
        // notifyProgress('helper', 'progress', '🧹 Auto-closed a blocking modal/popup');
        await new Promise(r => setTimeout(r, 500)); // Wait for animation
      }
      return closed;
    } catch (e) {
      return false;
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Full Page Analyzer - Detect ALL inputs on page
  // ═══════════════════════════════════════════════════════════════
  async _analyzeFullPage(page) {
    return await page.evaluate(() => {
      const inputs = [];
      const allInputs = document.querySelectorAll('input, textarea, select');

      allInputs.forEach((el, index) => {
        if (el.type === 'hidden' || el.offsetParent === null) return;

        // Find associated label
        let label = '';
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${el.id}"]`);
          if (labelEl) label = labelEl.textContent.trim();
        }
        if (!label) {
          const parent = el.closest('label, .form-group, .field');
          if (parent) label = parent.textContent?.split('\n')[0]?.trim() || '';
        }

        inputs.push({
          index,
          tag: el.tagName.toLowerCase(),
          type: el.type || 'text',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          label: label,
          required: el.required,
          value: el.value || '',
          selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : `input[type="${el.type}"]:nth-of-type(${index + 1})`)
        });
      });

      // Detect captcha elements
      const captcha = {
        image: document.querySelector('img[src*="captcha"], img[id*="captcha"], .captcha-image')?.src || null,
        input: document.querySelector('input[name*="captcha"], input[id*="captcha"]')?.id || null
      };

      // Detect submit button
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button.submit');

      return {
        inputs,
        captcha,
        submitButton: submitBtn ? (submitBtn.id ? `#${submitBtn.id}` : 'button[type="submit"]') : null,
        totalInputs: inputs.length
      };
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Fill form fields with Sequential Tab Navigation
  // ═══════════════════════════════════════════════════════════════
  async _fillFormFields(page, formData, formSelector, humanLike = true, aiMatch = true) {
    const targetForm = formSelector || 'form';
    const fields = Object.keys(formData || {});
    let filledCount = 0;
    const filledFields = [];
    const unfilledFields = [];

    // First, analyze the full page
    const pageInfo = await handlers._analyzeFullPage(page);
    notifyProgress('solve_captcha', 'progress', `🔍 Page analyzed: ${pageInfo.totalInputs} inputs found`);

    for (const [field, value] of Object.entries(formData || {})) {
      // Enhanced AI Field Matching - uses pageInfo for better matching
      let bestMatch = null;
      let bestScore = 0;

      for (const input of pageInfo.inputs) {
        let score = 0;
        const fieldLower = field.toLowerCase();

        // Exact matches
        if (input.name.toLowerCase() === fieldLower) score = 100;
        else if (input.id.toLowerCase() === fieldLower) score = 95;
        // Partial matches
        else if (input.name.toLowerCase().includes(fieldLower)) score = 80;
        else if (input.id.toLowerCase().includes(fieldLower)) score = 75;
        else if (input.placeholder.toLowerCase().includes(fieldLower)) score = 70;
        else if (input.label.toLowerCase().includes(fieldLower)) score = 65;
        // Type-based matching
        else if (fieldLower.includes('email') && input.type === 'email') score = 60;
        else if (fieldLower.includes('pass') && input.type === 'password') score = 60;
        else if (fieldLower.includes('phone') && input.type === 'tel') score = 60;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = input;
        }
      }

      if (!bestMatch || bestScore < 50) {
        unfilledFields.push(field);
        continue;
      }

      try {
        const element = await page.$(bestMatch.selector);
        if (!element) {
          unfilledFields.push(field);
          continue;
        }

        // Focus element first (human-like)
        await element.focus();
        await new Promise(r => setTimeout(r, 100 + Math.random() * 150));

        if (bestMatch.tag === 'select') {
          // Smart Select
          await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.value = val;
            if (el.value !== val) {
              for (const opt of el.options) {
                if (opt.text.toLowerCase().includes(val.toLowerCase())) {
                  el.value = opt.value;
                  break;
                }
              }
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, bestMatch.selector, String(value));
        } else if (bestMatch.type === 'checkbox' || bestMatch.type === 'radio') {
          if (value) await element.click();
        } else {
          // Text input - clear and type with human behavior
          await element.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await new Promise(r => setTimeout(r, 50));

          if (humanLike) {
            // Human-like typing with variable delays
            for (let i = 0; i < String(value).length; i++) {
              const char = String(value)[i];
              await page.keyboard.type(char);
              // Variable delay based on character type
              const delay = char === ' ' ? 80 : (30 + Math.random() * 70);
              await new Promise(r => setTimeout(r, delay));
            }
          } else {
            await page.type(bestMatch.selector, String(value));
          }
        }

        // Tab to next field (human-like navigation)
        if (humanLike) {
          await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
          await page.keyboard.press('Tab');
          await new Promise(r => setTimeout(r, 50));
        }

        filledCount++;
        filledFields.push({ field, selector: bestMatch.selector, matchScore: bestScore });
        notifyProgress('solve_captcha', 'progress', `📝 Filled: ${field} (score: ${bestScore})`, { field, filledCount });
      } catch (e) {
        unfilledFields.push(field);
      }
    }

    return {
      success: filledCount > 0,
      filledCount,
      filledFields,
      unfilledFields,
      totalFields: fields.length,
      pageInfo
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Pre-Submit Validation - Check all required fields filled
  // ═══════════════════════════════════════════════════════════════
  async _validateBeforeSubmit(page) {
    return await page.evaluate(() => {
      const errors = [];
      const requiredFields = document.querySelectorAll('[required], .required input');

      requiredFields.forEach(field => {
        if (!field.value || field.value.trim() === '') {
          const label = field.name || field.id || field.placeholder || 'Unknown';
          errors.push({ field: label, error: 'Required field is empty' });
        }
      });

      // Check for visible error messages
      const errorMsgs = document.querySelectorAll('.error, .error-message, .invalid-feedback, [class*="error"]');
      errorMsgs.forEach(el => {
        if (el.offsetParent !== null && el.textContent.trim()) {
          errors.push({ field: 'form', error: el.textContent.trim() });
        }
      });

      return { valid: errors.length === 0, errors };
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Post-Submit Error Detection
  // ═══════════════════════════════════════════════════════════════
  async _detectPostSubmitErrors(page) {
    await new Promise(r => setTimeout(r, 1500)); // Wait for page response

    return await page.evaluate(() => {
      const errors = [];

      // Check for error messages
      const errorSelectors = [
        '.error', '.error-message', '.alert-danger', '.invalid',
        '[class*="error"]', '[class*="invalid"]', '.captcha-error'
      ];

      for (const sel of errorSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (el.offsetParent !== null && el.textContent.trim()) {
            errors.push(el.textContent.trim());
          }
        });
      }

      // Check if captcha input is still visible (might indicate wrong captcha)
      const captchaInput = document.querySelector('input[name*="captcha"], input[id*="captcha"]');
      if (captchaInput && captchaInput.offsetParent !== null && !captchaInput.value) {
        errors.push('Captcha may have failed - input is empty');
      }

      return {
        hasErrors: errors.length > 0,
        errors: [...new Set(errors)].slice(0, 5) // Unique errors, max 5
      };
    });
  },

  // 1. Browser Init
  async browser_init(params = {}) {
    notifyProgress('browser_init', 'started', 'Initializing browser...');

    const { connect } = require('../../lib/cjs/index.js');

    // Get headless from params OR environment variable
    const envHeadless = getHeadlessFromEnv();
    const headless = params.headless !== undefined ? params.headless : envHeadless;

    const { proxy = {}, turnstile = false, enableBlocker = true } = params;

    notifyProgress('browser_init', 'progress', `Mode: ${headless ? 'Headless' : 'GUI (Visible)'}`, { headless });

    const result = await connect({
      headless,
      proxy,
      turnstile,
      enableBlocker,
    });

    browserInstance = result.browser;
    pageInstance = result.page;
    blockerInstance = result.blocker;
    setupPageFn = result.setupPage; // Store CDP early injection function

    // ═══════════════════════════════════════════════════════════════
    // GLOBAL DIALOG HANDLER - Auto-handle dialogs
    // Logic: BLOCK redirects to external sites, ACCEPT everything else
    // ═══════════════════════════════════════════════════════════════
    pageInstance.on('dialog', async (dialog) => {
      const dialogType = dialog.type();
      const msg = dialog.message().toLowerCase();

      notifyProgress('browser_init', 'progress',
        `🔔 Handling dialog: ${dialogType} - ${dialog.message().substring(0, 100)}...`);

      try {
        // Critical Fix: BLOCK redirects to external sites (e.g., eCommittee)
        // These redirects take the user away from the search page
        if (msg.includes('redirect') || msg.includes('external') || msg.includes('leaving')) {
          console.error('🚫 Blocking redirect dialog (Dismiss)');
          await dialog.dismiss(); // Simulate clicking 'Cancel'
        } else {
          // Auto-accept other dialogs (like alerts or simple confirmations)
          await dialog.accept(); // Simulate clicking 'OK'
        }
      } catch (e) {
        // Ignore errors (dialog might be closed by injected script)
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // INJECTED SCRIPT - Silent Handling of Popups
    // Override window.confirm/alert to handle them inside the page context
    // Note: Using addInitScript (Playwright) to intercept popups early
    // ═══════════════════════════════════════════════════════════════
    await pageInstance.addInitScript(() => {
      window.originalConfirm = window.confirm;
      window.originalAlert = window.alert;

      // Smart Confirm Handler
      window.confirm = (msg) => {
        console.log('Intercepted Confirm Dialog:', msg);
        if (msg && (msg.toLowerCase().includes('redirect') || msg.toLowerCase().includes('external'))) {
          console.log('🚫 Blocking redirect confirmation inside page');
          return false; // Return FALSE = Click Cancel
        }
        return true; // Return TRUE = Click OK
      };

      // Silently ignore alerts (always OK)
      window.alert = (msg) => {
        console.log('Blocked Alert Dialog:', msg);
        return true;
      };

      // Silently return null for prompts
      window.prompt = (msg) => {
        console.log('Blocked Prompt Dialog:', msg);
        return null;
      };
    });

    const pid = browserInstance.process()?.pid;

    notifyProgress('browser_init', 'completed', `Browser started (PID: ${pid})`, {
      headless,
      pid,
      blockerEnabled: enableBlocker
    });

    return {
      success: true,
      message: `Browser initialized in ${headless ? 'headless' : 'GUI'} mode`,
      pid,
      headless,
      blockerEnabled: enableBlocker
    };
  },

  // 2. Navigate (ENHANCED - handles context destroyed errors, retries)
  async navigate(params) {
    const { page } = requireBrowser();
    const { url, waitUntil = 'networkidle2', timeout = 30000, retries = 2 } = params;

    notifyProgress('navigate', 'started', `Navigating to: ${url}`);

    // ═══════════════════════════════════════════════════════════════
    // CDP EARLY INJECTION - Setup BEFORE navigation for better ad blocking
    // This ensures CSS and scripts are injected before page scripts run
    // ═══════════════════════════════════════════════════════════════
    console.error('[Navigate] setupPageFn available:', !!setupPageFn);
    if (setupPageFn) {
      try {
        await setupPageFn(page);
        notifyProgress('navigate', 'progress', 'CDP early injection setup complete');
        console.error('[Navigate] CDP early injection SUCCESS');
      } catch (e) {
        // Non-critical error, continue navigation
        console.error('[Navigate] CDP early injection failed:', e.message);
      }
    } else {
      console.error('[Navigate] No setupPageFn available - CDP early injection skipped');
    }

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Wait a bit if this is a retry
        if (attempt > 0) {
          notifyProgress('navigate', 'progress', `Retry attempt ${attempt}...`);
          await new Promise(r => setTimeout(r, 1000));
        }

        await page.goto(url, { waitUntil, timeout });

        // Wait for page to stabilize after navigation
        await new Promise(r => setTimeout(r, 500));

        // Try to get title with error handling
        let title = '';
        try {
          title = await page.title();
        } catch (e) {
          // Title might fail if page is still loading
          title = 'Loading...';
        }

        notifyProgress('navigate', 'completed', `Loaded: ${title}`, { url: page.url(), title });

        return {
          success: true,
          url: page.url(),
          title
        };
      } catch (error) {
        lastError = error;

        // Handle specific errors that might be recoverable
        if (error.message?.includes('Execution context was destroyed') ||
          error.message?.includes('context') ||
          error.message?.includes('Target closed')) {

          notifyProgress('navigate', 'progress', `Navigation interrupted (${error.message.substring(0, 50)}...), waiting for page...`);

          // Wait for any ongoing navigation to complete
          try {
            await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => { });
          } catch (e) {
            // Ignore timeout
          }

          // Check if we actually landed on the page
          try {
            const currentUrl = page.url();
            if (currentUrl && currentUrl !== 'about:blank') {
              const title = await page.title().catch(() => 'Unknown');
              notifyProgress('navigate', 'completed', `Loaded after recovery: ${title}`, { url: currentUrl, title });
              return {
                success: true,
                url: currentUrl,
                title,
                recovered: true
              };
            }
          } catch (e) {
            // Continue to retry
          }
        } else {
          // Non-recoverable error, throw immediately
          throw error;
        }
      }
    }

    // All retries failed
    notifyProgress('navigate', 'error', `Navigation failed after ${retries + 1} attempts: ${lastError?.message}`);
    throw lastError || new Error('Navigation failed');
  },

  // 3. Get Content
  async get_content(params = {}) {
    const { page } = requireBrowser();
    const { format = 'text', selector, rawHttpUrl } = params;

    notifyProgress('get_content', 'started', `Extracting ${format} content${selector ? ` from ${selector}` : ''}`);

    // === rawHttp mode: fetch raw HTTP response without JS rendering ===
    if (format === 'rawHttp') {
      const url = rawHttpUrl || page.url();
      notifyProgress('get_content', 'in_progress', `Fetching raw HTTP (no JS) from: ${url}`);
      try {
        const cookies = await page.cookies(url);
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const response = await fetch(url, {
          headers: {
            'User-Agent': await page.evaluate(() => navigator.userAgent),
            'Cookie': cookieStr,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': page.url()
          },
          redirect: 'follow'
        });
        const rawHtml = await response.text();
        const renderedHtml = await page.content();
        const diff = {
          rawLength: rawHtml.length,
          renderedLength: renderedHtml.length,
          sizeDifference: renderedHtml.length - rawHtml.length,
          jsLoadedContent: renderedHtml.length > rawHtml.length * 1.1
        };
        notifyProgress('get_content', 'completed', `Raw: ${diff.rawLength} chars, Rendered: ${diff.renderedLength} chars`);
        return {
          success: true, rawHtml, renderedHtml, diff,
          url, finalUrl: response.url, statusCode: response.status, format: 'rawHttp'
        };
      } catch (e) {
        return { success: false, error: `Raw HTTP fetch failed: ${e.message}` };
      }
    }

    let content;

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        notifyProgress('get_content', 'error', `Element not found: ${selector}`);
        return { success: false, error: `Element not found: ${selector}` };
      }

      if (format === 'html') {
        content = await element.evaluate(el => el.outerHTML);
      } else {
        content = await element.evaluate(el => el.textContent);
      }
    } else {
      if (format === 'html') {
        content = await page.content();
      } else if (format === 'markdown') {
        content = await page.evaluate(() => {
          const body = document.body.innerText;
          return body;
        });
      } else {
        content = await page.evaluate(() => document.body.innerText);
      }
    }

    notifyProgress('get_content', 'completed', `Extracted ${content.length} characters`, { format, length: content.length });

    return {
      success: true,
      content,
      url: page.url(),
      format
    };
  },

  // 4. Wait
  async wait(params) {
    const { page } = requireBrowser();
    const { type = 'timeout', value, timeout = 30000 } = params;

    notifyProgress('wait', 'started', `Waiting for ${type}: ${value}`);

    switch (type) {
      case 'selector':
        await page.waitForSelector(value, { timeout });
        break;
      case 'navigation':
        await page.waitForNavigation({ timeout });
        break;
      case 'networkidle':
        await page.waitForNetworkIdle({ timeout });
        break;
      case 'timeout':
      default:
        await new Promise(r => setTimeout(r, parseInt(value) || 1000));
    }

    notifyProgress('wait', 'completed', `Wait completed: ${type}`, { type, value });

    return { success: true, type, value };
  },

  // 5. Click (ENHANCED: iframe + hover + auto video player detection)
  async click(params) {
    const { page } = requireBrowser();
    const {
      selector,
      humanLike = true,
      clickCount = 1,
      delay = 0,
      autoAcceptDialogs = true,
      retries = 3,
      timeout = 60000,
      // Hover support for video player dynamic controls
      hoverFirst = false,
      hoverOnly = false,
      hoverDuration = 500,
      // iframe support
      iframe,
      iframeSelector,
      // Additional options
      scrollIntoView = true,
      forceClick = false,
      // NEW: Auto Video Player Detection & Control
      autoDetectPlayer = false,
      usePlayerAPI = true,
      waitForPlay = false,
      playerTimeout = 15000
    } = params;

    notifyProgress('click', 'started', `${hoverOnly ? 'Hovering' : 'Clicking'}: ${selector}${iframe !== undefined ? ` (iframe ${iframe})` : ''}${autoDetectPlayer ? ' (auto-detect player)' : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;
    let detectedPlayer = null;

    // ═══════════════════════════════════════════════════════════════
    // AUTO DETECT VIDEO PLAYER - Scan all iframes for video players
    // Supports: JWPlayer, VideoJS, Plyr, VidStack, DooPlayer, HTML5
    // ═══════════════════════════════════════════════════════════════
    if (autoDetectPlayer) {
      notifyProgress('click', 'progress', '🔍 Scanning all iframes for video players...');

      const frames = page.frames();

      for (let i = 0; i < frames.length; i++) {
        try {
          const frame = frames[i];
          const frameUrl = frame.url();

          // Skip blank frames
          if (frameUrl === 'about:blank' || !frameUrl) continue;

          // Detect player in this frame
          const playerInfo = await frame.evaluate(() => {
            const result = {
              hasPlayer: false,
              playerType: null,
              hasVideo: false,
              videoState: null,
              controls: [],
              downloadButton: null
            };

            // Check for video element
            const video = document.querySelector('video');
            if (video) {
              result.hasVideo = true;
              result.videoState = {
                paused: video.paused,
                currentTime: video.currentTime,
                duration: video.duration,
                readyState: video.readyState
              };
            }

            // 1. JWPlayer Detection
            if (window.jwplayer && typeof window.jwplayer === 'function') {
              try {
                const jw = window.jwplayer();
                if (jw && jw.getState) {
                  result.hasPlayer = true;
                  result.playerType = 'jwplayer';
                  result.playerState = jw.getState();
                  result.controls.push('.jw-icon-display', '.jw-icon-playback', '[aria-label="Play"]');

                  // Find download button in JWPlayer
                  const dlBtn = document.querySelector('[aria-label="Download"], .jw-icon-download, [class*="download"]');
                  if (dlBtn) result.downloadButton = '[aria-label="Download"]';
                }
              } catch (e) { }
            }

            // 2. VideoJS Detection
            if (window.videojs || document.querySelector('.video-js')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'videojs';
              result.controls.push('.vjs-big-play-button', '.vjs-play-control');
            }

            // 3. Plyr Detection
            if (window.Plyr || document.querySelector('.plyr')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'plyr';
              result.controls.push('.plyr__control--play', '[data-plyr="play"]');
            }

            // 4. VidStack Detection
            if (window.VidStack || document.querySelector('media-player')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'vidstack';
              result.controls.push('media-play-button', '[data-media-play]');
            }

            // 5. DooPlayer Detection
            if (window.DooPlay || document.querySelector('#dooplay') || document.querySelector('.dooplay')) {
              result.hasPlayer = true;
              result.playerType = result.playerType || 'dooplayer';
              result.controls.push('.play-btn', '.dooplay-play');
            }

            // 6. Generic HTML5 Video
            if (result.hasVideo && !result.hasPlayer) {
              result.hasPlayer = true;
              result.playerType = 'html5';
              result.controls.push('video');
            }

            // Find any download button
            if (!result.downloadButton) {
              const dlSelectors = [
                '[aria-label="Download"]', '[aria-label*="download"]',
                '.download-btn', '.download', '[class*="download"]',
                'a[download]', 'button[class*="download"]'
              ];
              for (const sel of dlSelectors) {
                if (document.querySelector(sel)) {
                  result.downloadButton = sel;
                  break;
                }
              }
            }

            return result;
          }).catch(() => ({ hasPlayer: false }));

          if (playerInfo.hasPlayer) {
            context = frame;
            frameInfo = {
              index: i,
              url: frameUrl,
              autoDetected: true
            };
            detectedPlayer = {
              type: playerInfo.playerType,
              state: playerInfo.playerState || playerInfo.videoState,
              controls: playerInfo.controls,
              downloadButton: playerInfo.downloadButton
            };

            notifyProgress('click', 'progress',
              `✅ Found ${playerInfo.playerType.toUpperCase()} in iframe ${i}: ${frameUrl.substring(0, 50)}...`);
            break;
          }
        } catch (e) {
          // Skip frames that can't be accessed
          continue;
        }
      }

      if (!detectedPlayer) {
        notifyProgress('click', 'progress', '⚠️ No video player found in any iframe, using main page');
      }
    }

    // Manual iframe selection (if not auto-detected)
    if (!autoDetectPlayer && (iframe !== undefined || iframeSelector)) {
      try {
        const frames = page.frames();

        if (iframe !== undefined && frames[iframe]) {
          context = frames[iframe];
          frameInfo = { index: iframe, url: frames[iframe].url() };
          notifyProgress('click', 'progress', `Switched to iframe ${iframe}: ${frames[iframe].url().substring(0, 50)}...`);
        } else if (iframeSelector) {
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame;
              frameInfo = { selector: iframeSelector, url: frame.url() };
              notifyProgress('click', 'progress', `Switched to iframe by selector: ${iframeSelector}`);
            }
          }
        }
      } catch (e) {
        notifyProgress('click', 'progress', `Warning: Could not switch to iframe - ${e.message}`);
      }
    }

    // Auto-close any blocking modals before clicking
    await handlers._handleBlockingModals(page);

    // Auto-handle dialogs
    let dialogHandled = false;
    const dialogHandler = async (dialog) => {
      dialogHandled = true;
      const type = dialog.type();
      const message = dialog.message();
      notifyProgress('click', 'progress', `🔔 Auto-accepting ${type}: ${message.substring(0, 50)}...`);
      try {
        await dialog.accept();
      } catch (e) { }
    };

    if (autoAcceptDialogs) {
      page.on('dialog', dialogHandler);
    }

    let lastError = null;
    let playerResult = null;

    try {
      // ═══════════════════════════════════════════════════════════════
      // USE PLAYER API - More reliable than DOM click for video players
      // ═══════════════════════════════════════════════════════════════
      if (usePlayerAPI && detectedPlayer && (selector === 'video' || selector.includes('play') || selector.includes('Play'))) {
        notifyProgress('click', 'progress', `🎬 Using ${detectedPlayer.type} API for playback...`);

        playerResult = await context.evaluate((playerType) => {
          const result = { success: false, method: null, state: null };

          try {
            if (playerType === 'jwplayer' && window.jwplayer) {
              const jw = window.jwplayer();
              const stateBefore = jw.getState();
              jw.play();
              result.success = true;
              result.method = 'jwplayer.play()';
              result.stateBefore = stateBefore;
              result.stateAfter = jw.getState();
            } else if (playerType === 'videojs' && window.videojs) {
              const player = window.videojs.getPlayers()[Object.keys(window.videojs.getPlayers())[0]];
              if (player) {
                player.play();
                result.success = true;
                result.method = 'videojs.play()';
              }
            } else if (playerType === 'plyr' && window.Plyr) {
              const plyr = document.querySelector('.plyr')?.__plyr;
              if (plyr) {
                plyr.play();
                result.success = true;
                result.method = 'plyr.play()';
              }
            } else {
              // Fallback to HTML5 video
              const video = document.querySelector('video');
              if (video) {
                video.play();
                result.success = true;
                result.method = 'video.play()';
              }
            }
          } catch (e) {
            result.error = e.message;
          }

          return result;
        }, detectedPlayer.type).catch(e => ({ success: false, error: e.message }));

        if (playerResult.success) {
          notifyProgress('click', 'progress', `✅ ${playerResult.method} executed`);

          // Wait for play if requested
          if (waitForPlay) {
            notifyProgress('click', 'progress', '⏳ Waiting for video to start playing...');

            const startTime = Date.now();
            let isPlaying = false;

            while (Date.now() - startTime < playerTimeout) {
              const state = await context.evaluate(() => {
                const video = document.querySelector('video');
                if (video) {
                  return {
                    paused: video.paused,
                    currentTime: video.currentTime,
                    playing: !video.paused && video.currentTime > 0
                  };
                }
                if (window.jwplayer) {
                  const jw = window.jwplayer();
                  return { playing: jw.getState() === 'playing', jwState: jw.getState() };
                }
                return { playing: false };
              }).catch(() => ({ playing: false }));

              if (state.playing || state.currentTime > 0) {
                isPlaying = true;
                notifyProgress('click', 'progress', `▶️ Video is now playing (${state.currentTime?.toFixed(1) || 0}s)`);
                break;
              }

              await new Promise(r => setTimeout(r, 500));
            }

            if (!isPlaying) {
              notifyProgress('click', 'progress', '⚠️ Video may still be buffering');
            }
          }

          notifyProgress('click', 'completed', `Video playback started via ${playerResult.method}`, {
            selector,
            clicked: true,
            playerAPI: true,
            detectedPlayer,
            iframe: frameInfo,
            playerResult
          });

          return {
            success: true,
            selector,
            clicked: true,
            playerAPI: true,
            detectedPlayer,
            iframe: frameInfo,
            playerResult,
            dialogHandled
          };
        }
      }

      // Retry loop for regular click
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          // Wait for selector with timeout
          try {
            await context.waitForSelector(selector, { timeout: Math.min(timeout / retries, 10000) });
          } catch (e) {
            if (attempt < retries) {
              notifyProgress('click', 'progress', `Selector not found, retry ${attempt}/${retries}...`);
              await new Promise(r => setTimeout(r, 1000));
              continue;
            }
            throw new Error(`Selector not found: ${selector}`);
          }

          // Scroll into view if needed
          if (scrollIntoView) {
            await context.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, selector);
            await new Promise(r => setTimeout(r, 300));
          }

          // HOVER functionality (for video player dynamic controls)
          if (hoverFirst || hoverOnly) {
            notifyProgress('click', 'progress', `Hovering over ${selector}...`);

            try {
              await context.hover(selector);
              notifyProgress('click', 'progress', `Hover successful, waiting ${hoverDuration}ms for controls...`);
              await new Promise(r => setTimeout(r, hoverDuration));
            } catch (hoverErr) {
              notifyProgress('click', 'progress', `Standard hover failed, trying mouse movement...`);
              const element = await context.$(selector);
              if (element) {
                const box = await element.boundingBox();
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await new Promise(r => setTimeout(r, hoverDuration));
                }
              }
            }

            if (hoverOnly) {
              notifyProgress('click', 'completed', `Hover completed: ${selector}`, { selector, hovered: true, iframe: frameInfo });
              return { success: true, selector, hovered: true, clicked: false, iframe: frameInfo, detectedPlayer };
            }
          }

          // CLICK functionality
          if (forceClick) {
            await context.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.click();
            }, selector);
            notifyProgress('click', 'progress', 'Used force click (JS)');
          } else if (humanLike) {
            try {
              const { createCursor } = require('ghost-cursor-patchright');
              const cursor = createCursor(page);

              if (context !== page) {
                const element = await context.$(selector);
                if (element) {
                  const box = await element.boundingBox();
                  if (box) {
                    await cursor.moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount, delay });
                  }
                }
              } else {
                await cursor.click(selector);
              }
              notifyProgress('click', 'progress', 'Used human-like cursor movement');
            } catch (e) {
              await context.click(selector, { clickCount, delay });
            }
          } else {
            await context.click(selector, { clickCount, delay });
          }

          await new Promise(r => setTimeout(r, 300));

          notifyProgress('click', 'completed',
            `${hoverFirst ? 'Hovered+' : ''}Clicked: ${selector}${dialogHandled ? ' (dialog auto-accepted)' : ''}`,
            { selector, humanLike, dialogHandled, iframe: frameInfo, detectedPlayer, attempts: attempt }
          );

          return {
            success: true,
            selector,
            clicked: true,
            dialogHandled,
            iframe: frameInfo,
            detectedPlayer,
            attempts: attempt
          };

        } catch (attemptError) {
          lastError = attemptError;
          if (attempt < retries) {
            notifyProgress('click', 'progress', `Attempt ${attempt} failed: ${attemptError.message}, retrying...`);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      throw lastError || new Error('Click failed after all retries');

    } finally {
      if (autoAcceptDialogs) {
        page.off('dialog', dialogHandler);
      }
    }
  },

  // 6. Type (ENHANCED: iframe support)
  async type(params) {
    const { page } = requireBrowser();
    const {
      selector,
      text,
      delay = 50,
      clear = false,
      // NEW: iframe support
      iframe,
      iframeSelector,
      // NEW: Additional options
      pressEnter = false,
      waitForSelector = true
    } = params;

    notifyProgress('type', 'started', `Typing ${text.length} characters into ${selector}${iframe !== undefined ? ` (iframe ${iframe})` : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;

    if (iframe !== undefined || iframeSelector) {
      try {
        const frames = page.frames();

        if (iframe !== undefined && frames[iframe]) {
          context = frames[iframe];
          frameInfo = { index: iframe, url: frames[iframe].url() };
          notifyProgress('type', 'progress', `Switched to iframe ${iframe}`);
        } else if (iframeSelector) {
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame;
              frameInfo = { selector: iframeSelector, url: frame.url() };
              notifyProgress('type', 'progress', `Switched to iframe by selector`);
            }
          }
        }
      } catch (e) {
        notifyProgress('type', 'progress', `Warning: Could not switch to iframe - ${e.message}`);
      }
    }

    // Auto-close any blocking modals before typing
    await handlers._handleBlockingModals(page);

    // Wait for selector if enabled
    if (waitForSelector) {
      try {
        await context.waitForSelector(selector, { timeout: 10000 });
      } catch (e) {
        notifyProgress('type', 'error', `Selector not found: ${selector}`);
        return { success: false, error: `Selector not found: ${selector}` };
      }
    }

    // Clear existing text if needed
    if (clear) {
      await context.click(selector, { clickCount: 3 });
      await context.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.value = '';
      }, selector);
      notifyProgress('type', 'progress', 'Cleared existing text');
    }

    // Type text with human-like delays
    await context.type(selector, text, { delay });

    // Press Enter if requested
    if (pressEnter) {
      await context.keyboard.press('Enter');
      notifyProgress('type', 'progress', 'Pressed Enter');
    }

    notifyProgress('type', 'completed', `Typed ${text.length} characters`, { selector, textLength: text.length, iframe: frameInfo });

    return { success: true, selector, textLength: text.length, iframe: frameInfo };
  },

  // 7. Browser Close
  async browser_close(params = {}) {
    const { force = false } = params;

    notifyProgress('browser_close', 'started', 'Closing browser...');

    if (browserInstance) {
      try {
        await browserInstance.close();
        notifyProgress('browser_close', 'progress', 'Browser closed gracefully');
      } catch (e) {
        if (force) {
          browserInstance.process()?.kill('SIGKILL');
          notifyProgress('browser_close', 'progress', 'Browser force killed');
        }
      }
      browserInstance = null;
      pageInstance = null;
      blockerInstance = null;
      setupPageFn = null;
    }

    notifyProgress('browser_close', 'completed', 'Browser closed');

    return { success: true, message: 'Browser closed' };
  },

  // HELPER: Validate captcha text against expected constraints
  _validateCaptchaText(text, expectedLength, allowedChars) {
    if (!text || text.trim() === '') return { valid: false, reason: 'Empty text' };
    if (expectedLength && text.length !== expectedLength) {
      return { valid: false, reason: `Expected ${expectedLength} chars, got ${text.length}` };
    }
    if (allowedChars) {
      const regex = new RegExp('^[' + allowedChars + ']+$');
      if (!regex.test(text)) return { valid: false, reason: 'Contains chars outside allowed set: ' + allowedChars };
    }
    return { valid: true };
  },

  // 8. Solve Captcha (MERGED with form_automator - handles both CAPTCHA and form automation)
  async solve_captcha(params = {}) {
    const { page } = requireBrowser();
    const {
      type = 'auto',
      timeout = 30000,
      // AI Vision option
      aiMode = true,
      // OCR-specific options
      captchaSelector,
      inputSelector,
      refreshSelector,
      lang = 'eng',
      expectedLength,
      allowedChars,
      maxRetries = 3,
      // iFrame Support
      iframe = null,
      iframeSelector = null,
      // Accuracy options
      analyzeFirst = true,     // Analyze page before solving
      autoRetry = true,        // Auto-retry until success
      // MERGED: Form automation options (from form_automator)
      formData,                // Form field data to fill
      formSelector,            // Form selector (auto-detect if not provided)
      submit = false,          // Auto-submit after filling
      humanLike = true,        // Human-like typing delays
      aiMatch = true,          // AI matches fields even if names differ
    } = params;

    // Resolve target frame
    let targetFrame = page;
    if (iframe !== null && iframe !== undefined) {
      targetFrame = page.frames()[iframe];
      if (!targetFrame) return { success: false, error: `Iframe index ${iframe} not found` };
      notifyProgress('solve_captcha', 'progress', `🎯 Targeting iframe index ${iframe}...`);
    } else if (iframeSelector) {
      const elementHandle = await page.$(iframeSelector);
      if (elementHandle) {
        targetFrame = await elementHandle.contentFrame();
      }
      if (!targetFrame) return { success: false, error: `Iframe selector ${iframeSelector} not found` };
      notifyProgress('solve_captcha', 'progress', `🎯 Targeting iframe selector ${iframeSelector}...`);
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 0: FORM AUTOMATION (if formData is provided)
    // ═══════════════════════════════════════════════════════════════
    let formResult = null;
    if (formData && Object.keys(formData).length > 0) {
      notifyProgress('solve_captcha', 'started', `📋 Smart Form + Captcha Mode: Filling ${Object.keys(formData).length} fields...`);
      formResult = await handlers._fillFormFields(page, formData, formSelector, humanLike, aiMatch);
    } else {
      notifyProgress('solve_captcha', 'started', `🎯 100% Accuracy Mode: Solving ${type} captcha...`);
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: ANALYZE PAGE (if enabled)
    // ═══════════════════════════════════════════════════════════════
    let pageAnalysis = null;
    let detectedCaptchaSelector = captchaSelector;
    let detectedInputSelector = inputSelector;

    if (analyzeFirst) {
      notifyProgress('solve_captcha', 'progress', '🔍 Analyzing page structure...');

      pageAnalysis = await targetFrame.evaluate(() => {
        const result = {
          captchas: [],
          captchaInputs: [],
          forms: [],
        };

        // Find all captcha images
        const captchaSelectors = [
          'img[src*="captcha"]', 'img[alt*="captcha"]', 'img[id*="captcha"]',
          '.captcha-image', '#captcha_image', '#captchaImg', '.captcha',
          'img[src*="Captcha"]', 'canvas[id*="captcha"]'
        ];

        captchaSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            if (el.offsetParent !== null) { // Visible
              // AI is smart: we don't need hardcoded filters. We just grab candidate images.
              // To avoid grabbing top-header logos, we can just check if the image is inside a form.
              const isInsideForm = el.closest('form') !== null;
              
              result.captchas.push({
                selector: el.id ? `#${el.id}` : sel,
                src: el.src || null,
                width: el.width,
                height: el.height,
                isInsideForm: isInsideForm
              });
            }
          });
        });

        // Find captcha input fields
        const inputSelectors = [
          'input[name*="captcha"]', 'input[id*="captcha"]', '#fcaptcha_code',
          'input[placeholder*="captcha"]', 'input[placeholder*="Enter"]',
          '#captchaInput', '.captcha-input'
        ];

        inputSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            if (el.offsetParent !== null && el.type !== 'hidden') {
              result.captchaInputs.push({
                selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : sel),
                placeholder: el.placeholder,
                maxLength: el.maxLength > 0 ? el.maxLength : null,
              });
            }
          });
        });

        // Find forms
        document.querySelectorAll('form').forEach(form => {
          const hasCaptcha = form.querySelector('img[src*="captcha"], input[name*="captcha"]');
          if (hasCaptcha) {
            result.forms.push({
              id: form.id || null,
              action: form.action,
              submitBtn: form.querySelector('button[type="submit"], input[type="submit"]')?.id || null,
            });
          }
        });

        return result;
      });

      // Auto-detect selectors if not provided
      if (!captchaSelector && pageAnalysis.captchas.length > 0) {
        detectedCaptchaSelector = pageAnalysis.captchas[0].selector;
        notifyProgress('solve_captcha', 'progress', `📍 Auto-detected captcha: ${detectedCaptchaSelector}`);
      }

      if (!inputSelector && pageAnalysis.captchaInputs.length > 0) {
        detectedInputSelector = pageAnalysis.captchaInputs[0].selector;
        // Auto-detect expected length from maxLength
        if (!expectedLength && pageAnalysis.captchaInputs[0].maxLength) {
          params.expectedLength = pageAnalysis.captchaInputs[0].maxLength;
        }
        notifyProgress('solve_captcha', 'progress', `📍 Auto-detected input: ${detectedInputSelector}`);
      }
    }

    // Handle text/image captcha with OCR/Vision
    if (type === 'text' || type === 'image' || (type === 'auto' && detectedCaptchaSelector)) {
      if (!detectedCaptchaSelector) {
        return { success: false, error: 'captchaSelector not provided and could not auto-detect' };
      }

      const effectiveMaxRetries = autoRetry ? maxRetries : 1;

      for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
        try {
          notifyProgress('solve_captcha', 'progress', `📸 Capturing CAPTCHA image... (attempt ${attempt}/${effectiveMaxRetries})`);

          // If retrying, refresh captcha first
          if (attempt > 1 && refreshSelector) {
            try {
              notifyProgress('solve_captcha', 'progress', '🔄 Refreshing CAPTCHA...');
              await targetFrame.click(refreshSelector);
              await new Promise(r => setTimeout(r, 1500));
            } catch (refreshErr) {
              notifyProgress('solve_captcha', 'progress', `⚠️ Could not refresh captcha: ${refreshErr.message}`);
            }
          }

          let targetHandle = null;

          // 1. SMART AI CONTEXT: Try to capture the form container so AI sees the full context
          if (detectedInputSelector) {
            try {
              const containerHandle = await targetFrame.evaluateHandle((sel) => {
                const input = document.querySelector(sel);
                if (!input) return null;
                return input.closest('form') || input.closest('div.captcha-wrapper') || input.parentElement.parentElement || input.parentElement;
              }, detectedInputSelector);

              if (containerHandle && await containerHandle.evaluate(n => n !== null)) {
                targetHandle = containerHandle.asElement();
              }
            } catch(e) {}
          }

          // 2. Fallback to just the captcha image if no container found
          if (!targetHandle && detectedCaptchaSelector) {
            try {
              targetHandle = await targetFrame.waitForSelector(detectedCaptchaSelector, { timeout: 5000 });
            } catch(e) {}
          }

          if (!targetHandle) {
            return { success: false, error: 'Could not find elements to capture' };
          }

          // Scroll into view
          await targetHandle.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          await new Promise(r => setTimeout(r, 500));

          // Take base64 screenshot of just the captcha image for Vision API
          let captchaImageBase64 = null;
          try {
            const captchaEl = await targetFrame.$(detectedCaptchaSelector);
            if (captchaEl) {
              captchaImageBase64 = await captchaEl.screenshot({ encoding: 'base64' });
            }
          } catch(e) {}

          // Take full context screenshot for host LLM fallback
          const screenshotBase64 = await targetHandle.screenshot({ encoding: 'base64' });

          // ═══════════════════════════════════════════════════════════
          // STEP A: Server-Side Vision API (if aiMode enabled)
          // ═══════════════════════════════════════════════════════════
          if (aiMode) {
            const imageForApi = captchaImageBase64 || screenshotBase64;
            const langHint = lang !== 'eng' ? ` The text may be in ${lang === 'hin' ? 'Hindi' : lang} language.` : '';
            const captchaText = await handlers._solveWithVisionAPI(imageForApi, langHint);

            if (captchaText) {
              // Validate response against expected constraints
              const validation = handlers._validateCaptchaText(captchaText, expectedLength, allowedChars);
              if (!validation.valid) {
                notifyProgress('solve_captcha', 'progress', `⚠️ Validation failed: ${validation.reason} — "${captchaText}"`);
                if (attempt < effectiveMaxRetries) continue;
                notifyProgress('solve_captcha', 'progress', `⚠️ Last attempt, using unvalidated text: "${captchaText}"`);
              }

              if (detectedInputSelector) {
                notifyProgress('solve_captcha', 'progress', `🤖 Vision API solved: "${captchaText}" → typing...`);

                // Clear existing value and type the answer
                await targetFrame.evaluate((sel) => {
                  const el = document.querySelector(sel);
                  if (el) { el.value = ''; el.focus(); }
                }, detectedInputSelector);

                await targetFrame.type(detectedInputSelector, captchaText, { delay: 80 });
                notifyProgress('solve_captcha', 'progress', `✅ CAPTCHA filled: "${captchaText}"`);

                let submitResult = null;
                if (submit) {
                  notifyProgress('solve_captcha', 'progress', '🚀 Auto-submitting form...');
                  submitResult = await handlers._submitForm(targetFrame);

                  // Check if submit detected captcha errors → retry
                  if (submitResult && !submitResult.success && submitResult.needsRetry && autoRetry && attempt < effectiveMaxRetries) {
                    notifyProgress('solve_captcha', 'progress', `❌ Captcha appears wrong, retrying... (${attempt}/${effectiveMaxRetries})`);
                    continue;
                  }
                }

                notifyProgress('solve_captcha', 'completed', '🎉 CAPTCHA solved and filled automatically!');
                return {
                  success: true,
                  solved: true,
                  method: 'vision_api',
                  captchaText,
                  attempt,
                  formResult,
                  submitted: submit ? (submitResult?.success || false) : undefined
                };
              }
            }

            notifyProgress('solve_captcha', 'progress', `⚠️ Vision API could not solve (attempt ${attempt}/${effectiveMaxRetries})`);
            if (attempt < effectiveMaxRetries) continue;
          }

          // ═══════════════════════════════════════════════════════════
          // STEP B: Fallback → Send image to Host LLM
          // ═══════════════════════════════════════════════════════════
          notifyProgress('solve_captcha', 'progress', aiMode
            ? '📤 All Vision API attempts failed — sending image to host LLM...'
            : '📤 AI Vision disabled — sending image to host LLM...');

          const instructions = `[ACTION REQUIRED: VISION AI CAPTCHA SOLVER]\n\nI have successfully captured the CAPTCHA image (see attached).\n\n1. Please use your Vision capabilities to carefully read the text/characters in the image.\n2. Once you have the text, use the \`type\` tool with selector \`${detectedInputSelector || '<input_selector>'}\` to fill in the answer.\n3. If submit was requested (${submit ? 'YES' : 'NO'}), please submit the form after typing the answer.\n\nNote: Do NOT call \`solve_captcha\` again for this specific captcha, as you have already received the image.`;

          return {
            success: true,
            mcpContent: [
              { type: 'text', text: instructions },
              { type: 'image', data: screenshotBase64, mimeType: 'image/png' }
            ]
          };

        } catch (err) {
          notifyProgress('solve_captcha', 'error', `Vision capture error (attempt ${attempt}): ${err.message}`);
          if (attempt >= effectiveMaxRetries) {
            return { success: false, error: err.message, type: 'vision_capture', formResult };
          }
        }
      }

      return { success: false, error: 'All captcha solving attempts exhausted', formResult };
    }

    // Original Turnstile/reCAPTCHA/hCaptcha handling
    const start = Date.now();
    let attempts = 0;

    while (Date.now() - start < timeout) {
      attempts++;

      const turnstileToken = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : null;
      });

      if (turnstileToken) {
        notifyProgress('solve_captcha', 'completed', `Captcha solved after ${attempts} checks`, { type: 'turnstile', attempts });

        // MERGED: Handle form submission if requested
        if (submit) {
          notifyProgress('solve_captcha', 'progress', '🚀 Submitting form...');
          const submitResult = await handlers._submitForm(page);
          return {
            success: true,
            type: 'turnstile',
            solved: true,
            formResult,
            submitted: submitResult.success,
            submitMessage: submitResult.message
          };
        }

        return { success: true, type: 'turnstile', solved: true, formResult };
      }

      if (attempts % 10 === 0) {
        notifyProgress('solve_captcha', 'progress', `Still solving... (${attempts} checks)`, { attempts });
      }

      await new Promise(r => setTimeout(r, 500));
    }

    notifyProgress('solve_captcha', 'error', 'Captcha solving timeout');
    return { success: false, error: 'Captcha solving timeout', formResult };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VISION API HELPERS — Server-Side CAPTCHA Solving (No host LLM needed!)
  // Set NVIDIA_API_KEY or OPENROUTER_API_KEY in environment.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Dispatcher: tries NVIDIA → OpenRouter, returns null if none configured.
   * @param {string} imageBase64 - Base64 encoded captcha image
   * @param {string} langHint - Optional language hint to append to prompt
   */
  async _solveWithVisionAPI(imageBase64, langHint = '') {
    if (process.env.NVIDIA_API_KEY) {
      try {
        return await handlers._solveWithNvidia(imageBase64, langHint);
      } catch (e) {
        notifyProgress('solve_captcha', 'progress', `⚠️ NVIDIA API error: ${e.message}`);
      }
    }
    if (process.env.OPENROUTER_API_KEY) {
      try {
        return await handlers._solveWithOpenRouter(imageBase64, langHint);
      } catch (e) {
        notifyProgress('solve_captcha', 'progress', `⚠️ OpenRouter API error: ${e.message}`);
      }
    }
    return null; // No API configured — fallback to host LLM
  },





  /**
   * Solve CAPTCHA using NVIDIA NIM Vision API (OpenAI-compatible format).
   * Supports: meta/llama-4-maverick, nvidia/llama-3.1-nemotron, google/gemma, etc.
   */
  async _solveWithNvidia(imageBase64, langHint = '') {
    const https = require('https');
    const apiKey = process.env.NVIDIA_API_KEY;

    // NVIDIA vision models sorted by speed & reliability
    const models = [
      'z-ai/glm-4.7',
      'deepseek-ai/deepseek-v4-pro',
      'meta/llama-3.2-11b-vision-instruct',
      'meta/llama-4-maverick-17b-128e-instruct',
      'microsoft/phi-4-multimodal-instruct'
    ];

    for (const model of models) {
      notifyProgress('solve_captcha', 'progress', `🟢 NVIDIA: Trying ${model}...`);

      const requestBody = JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'This is a CAPTCHA image. Read ONLY the text/characters shown. Return ONLY the exact characters, nothing else.' + langHint
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${imageBase64}` }
            }
          ]
        }],
        max_tokens: 30,
        temperature: 0.1
      });

      try {
        const result = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'integrate.api.nvidia.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'Content-Length': Buffer.byteLength(requestBody)
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.error) {
                  notifyProgress('solve_captcha', 'progress', `⏭️ NVIDIA ${model}: ${(json.error.message || '').substring(0, 60)}`);
                  return resolve(null); // Try next model
                }
                const text = json?.choices?.[0]?.message?.content?.trim();
                if (!text) return resolve(null);
                const cleaned = text.replace(/[\s"'\n\r`]/g, '');
                notifyProgress('solve_captcha', 'progress', `✨ NVIDIA [${model.split('/')[1]}] extracted: "${cleaned}"`);
                resolve(cleaned || null);
              } catch (e) {
                resolve(null);
              }
            });
          });

          req.on('error', () => resolve(null));
          req.setTimeout(20000, () => { req.destroy(); resolve(null); });
          req.write(requestBody);
          req.end();
        });

        if (result) return result;
      } catch (e) {
        // Try next model
      }
    }

    throw new Error('All NVIDIA models failed');
  },

  /**
   * Solve CAPTCHA using OpenRouter API (Access to ALL free/paid vision models)
   */
  async _solveWithOpenRouter(imageBase64, langHint = '') {
    const https = require('https');
    const apiKey = process.env.OPENROUTER_API_KEY;

    // Best free vision models on OpenRouter (auto-fallback)
    const models = [
      'google/gemini-2.5-pro-free', // Insanely smart & free
      'meta-llama/llama-3.2-90b-vision-instruct:free',
      'qwen/qwen-vl-plus:free'
    ];

    for (const model of models) {
      notifyProgress('solve_captcha', 'progress', `🟢 OpenRouter: Trying ${model}...`);

      const requestBody = JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'This is a CAPTCHA image. Read ONLY the text/characters shown. Return ONLY the exact characters, nothing else.' + langHint },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
          ]
        }],
        max_tokens: 30,
        temperature: 0.1
      });

      try {
        const result = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://github.com/brave-browser',
              'X-Title': 'Brave MCP',
              'Content-Length': Buffer.byteLength(requestBody)
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.error) {
                  notifyProgress('solve_captcha', 'progress', `⏭️ OpenRouter ${model}: ${(json.error.message || '').substring(0, 60)}`);
                  return resolve(null); // Try next model
                }
                const text = json?.choices?.[0]?.message?.content?.trim();
                if (!text) return resolve(null);
                const cleaned = text.replace(/[\s"'\n\r`]/g, '');
                notifyProgress('solve_captcha', 'progress', `✨ OpenRouter [${model.split('/')[1]}] extracted: "${cleaned}"`);
                resolve(cleaned || null);
              } catch (e) {
                resolve(null);
              }
            });
          });

          req.on('error', () => resolve(null));
          req.setTimeout(20000, () => { req.destroy(); resolve(null); });
          req.write(requestBody);
          req.end();
        });

        if (result) return result;
      } catch (e) {
        // Try next model
      }
    }

    throw new Error('All OpenRouter models failed');
  },

  // HELPER: Submit form with smart detection, validation, and error handling
  async _submitForm(page, validateFirst = true, maxRetries = 1) {
    try {
      // Pre-submit validation
      if (validateFirst) {
        const validation = await handlers._validateBeforeSubmit(page);
        if (!validation.valid) {
          notifyProgress('solve_captcha', 'warn', `⚠️ Validation failed: ${validation.errors.length} issue(s)`);
          return { success: false, message: 'Pre-submit validation failed', errors: validation.errors };
        }
        notifyProgress('solve_captcha', 'progress', '✅ Pre-submit validation passed');
      }

      const submitSelector = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'));
        const candidates = buttons.filter(b => {
          const text = (b.innerText || b.value || '').toLowerCase();
          return text.includes('submit') || text.includes('go') || text.includes('search') ||
            text.includes('view') || text.includes('login') || text.includes('sign in') ||
            text.includes('register') || text.includes('send');
        });
        const best = candidates.find(b => b.offsetParent !== null);
        if (best) {
          return best.id ? `#${best.id}` : (best.name ? `[name="${best.name}"]` : 'button[type="submit"]');
        }
        // Fallback to any submit button
        const fallback = document.querySelector('button[type="submit"], input[type="submit"]');
        return fallback ? (fallback.id ? `#${fallback.id}` : 'button[type="submit"]') : null;
      });

      if (!submitSelector) {
        notifyProgress('solve_captcha', 'warn', '⚠️ Could not auto-detect submit button');
        return { success: false, message: 'Could not auto-detect submit button' };
      }

      // Click submit button with human-like behavior
      try {
        const { createCursor } = require('ghost-cursor-patchright');
        const cursor = createCursor(page);
        await cursor.click(submitSelector);
      } catch (e) {
        await page.click(submitSelector);
      }

      // Wait for response
      try {
        await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' });
        notifyProgress('solve_captcha', 'completed', '✅ Form submitted and navigation complete');
        return { success: true, message: 'Form submitted and navigation complete', navigated: true };
      } catch (e) {
        // No navigation - check for errors on same page
        const postErrors = await handlers._detectPostSubmitErrors(page);

        if (postErrors.hasErrors) {
          notifyProgress('solve_captcha', 'warn', `⚠️ Submit detected errors: ${postErrors.errors[0]}`);
          return {
            success: false,
            message: 'Form submitted but errors detected',
            errors: postErrors.errors,
            needsRetry: postErrors.errors.some(e => e.toLowerCase().includes('captcha'))
          };
        }

        notifyProgress('solve_captcha', 'completed', '✅ Form submitted (no navigation detected)');
        return { success: true, message: 'Form submitted (no navigation detected)', navigated: false };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  },


  // 9. Random Scroll
  async random_scroll(params = {}) {
    const { page } = requireBrowser();
    const { direction = 'down', amount = 0, smooth = true } = params;

    const scrollAmount = amount || Math.floor(Math.random() * 500) + 200;
    const scrollDirection = direction === 'random'
      ? (Math.random() > 0.5 ? 'down' : 'up')
      : direction;

    notifyProgress('random_scroll', 'started', `Scrolling ${scrollDirection} ${scrollAmount}px`);

    const y = scrollDirection === 'down' ? scrollAmount : -scrollAmount;
    if (smooth && page.realScroll) {
      await page.realScroll(y, 600);
    } else {
      await page.evaluate(({ y, smooth }) => {
        window.scrollBy({ top: y, behavior: smooth ? 'smooth' : 'auto' });
      }, { y, smooth });
    }

    notifyProgress('random_scroll', 'completed', `Scrolled ${scrollDirection} ${scrollAmount}px`, { direction: scrollDirection, amount: scrollAmount });

    return { success: true, direction: scrollDirection, amount: scrollAmount };
  },

  // 10. Find Element
  async find_element(params = {}) {
    const { page } = requireBrowser();
    const { selector, xpath, text, multiple = false } = params;

    notifyProgress('find_element', 'started', `Finding element: ${selector || xpath || text}`);

    let elements = [];

    if (selector) {
      if (multiple) {
        elements = await page.$$eval(selector, els => els.map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100),
          classes: el.className,
          id: el.id
        })));
      } else {
        const el = await page.$(selector);
        if (el) {
          elements = [await el.evaluate(el => ({
            tag: el.tagName,
            text: el.textContent?.substring(0, 100),
            classes: el.className,
            id: el.id
          }))];
        }
      }
    } else if (xpath) {
      const handles = await page.$x(xpath);
      elements = await Promise.all(handles.map(h => h.evaluate(el => ({
        tag: el.tagName,
        text: el.textContent?.substring(0, 100)
      }))));
    } else if (text) {
      elements = await page.$$eval('*', (els, text) =>
        els.filter(el => el.textContent?.includes(text))
          .slice(0, 10)
          .map(el => ({ tag: el.tagName, text: el.textContent?.substring(0, 100) })),
        text
      );
    }

    notifyProgress('find_element', 'completed', `Found ${elements.length} element(s)`, { found: elements.length });

    return { success: true, found: elements.length, elements };
  },

  // 11. Save Content as Markdown
  async save_content_as_markdown(params) {
    const { page } = requireBrowser();
    const { filename, selector, includeImages = true, includeMeta = true } = params;

    notifyProgress('save_content_as_markdown', 'started', `Saving to: ${filename}`);

    let markdown = '';

    if (includeMeta) {
      const title = await page.title();
      const url = page.url();
      markdown += `# ${title}\n\n`;
      markdown += `> Source: ${url}\n\n`;
    }

    const content = selector
      ? await page.$eval(selector, el => el.innerText)
      : await page.evaluate(() => document.body.innerText);

    markdown += content;

    const outputPath = path.resolve(filename);
    fs.writeFileSync(outputPath, markdown);

    notifyProgress('save_content_as_markdown', 'completed', `Saved ${markdown.length} bytes to ${filename}`, { filename: outputPath, size: markdown.length });

    return { success: true, filename: outputPath, size: markdown.length };
  },

  // 12. Redirect Tracer (ENHANCED - tracks HTTP + JS + Meta redirects)
  async redirect_tracer(params) {
    const { page } = requireBrowser();
    const { url, maxRedirects = 20, includeHeaders = false, followJS = true, timeout = 30000 } = params;

    notifyProgress('redirect_tracer', 'started', `Tracing redirects for: ${url}`);

    const redirects = [];
    const jsNavigations = [];
    let currentUrl = url;

    // HTTP redirect handler
    const responseHandler = response => {
      if ([301, 302, 303, 307, 308].includes(response.status())) {
        redirects.push({
          url: response.url(),
          status: response.status(),
          type: 'http',
          headers: includeHeaders ? response.headers() : undefined
        });
        notifyProgress('redirect_tracer', 'progress', `HTTP Redirect ${redirects.length}: ${response.status()}`, { status: response.status() });
      }
    };

    // JS/Navigation handler for tracking window.location changes
    const frameNavigatedHandler = frame => {
      if (frame === page.mainFrame()) {
        const newUrl = frame.url();
        if (newUrl !== currentUrl && newUrl !== 'about:blank') {
          jsNavigations.push({
            url: newUrl,
            type: 'js_navigation',
            fromUrl: currentUrl,
            timestamp: Date.now()
          });
          notifyProgress('redirect_tracer', 'progress', `JS Navigation: ${newUrl}`, { type: 'js' });
          currentUrl = newUrl;
        }
      }
    };

    page.on('response', responseHandler);
    page.on('framenavigated', frameNavigatedHandler);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout });

      // If followJS is enabled, wait a bit and check for meta refreshes and JS redirects
      if (followJS) {
        // Check for meta refresh tags
        const metaRefresh = await page.evaluate(() => {
          const meta = document.querySelector('meta[http-equiv="refresh"]');
          if (meta) {
            const content = meta.getAttribute('content');
            const match = content?.match(/url=(.+)/i);
            return match ? match[1].trim().replace(/['"]/g, '') : null;
          }
          return null;
        }).catch(() => null);

        if (metaRefresh) {
          jsNavigations.push({
            url: metaRefresh,
            type: 'meta_refresh',
            fromUrl: page.url()
          });
        }

        // Extract any onclick/href javascript: URLs
        const jsLinks = await page.evaluate(() => {
          const links = [];
          document.querySelectorAll('a[href^="javascript:"], [onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick');
            const href = el.getAttribute('href');
            if (onclick) {
              const match = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
              if (match) links.push({ url: match[1], type: 'onclick' });
            }
            if (href && href.includes('location')) {
              links.push({ url: href, type: 'javascript_href' });
            }
          });
          return links;
        }).catch(() => []);

        jsNavigations.push(...jsLinks);
      }
    } catch (e) {
      notifyProgress('redirect_tracer', 'progress', `Navigation error: ${e.message}`);
    }

    page.off('response', responseHandler);
    page.off('framenavigated', frameNavigatedHandler);

    const allRedirects = [
      ...redirects,
      ...jsNavigations.filter(nav => nav.url && nav.url.startsWith('http'))
    ];

    notifyProgress('redirect_tracer', 'completed',
      `Found ${redirects.length} HTTP + ${jsNavigations.length} JS redirects`,
      { httpRedirects: redirects.length, jsNavigations: jsNavigations.length, finalUrl: page.url() });

    return {
      success: true,
      originalUrl: url,
      finalUrl: page.url(),
      redirectCount: allRedirects.length,
      httpRedirects: redirects,
      jsNavigations: jsNavigations,
      allRedirects: allRedirects
    };
  },

  // 13. Search Regex
  async search_regex(params) {
    const { page } = requireBrowser();
    const { pattern, flags = 'gi', source = 'html' } = params;

    notifyProgress('search_regex', 'started', `Searching pattern: ${pattern}`);

    let content;
    if (source === 'html') {
      content = await page.content();
    } else if (source === 'scripts') {
      content = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
    } else {
      content = await page.evaluate(() => document.body.innerText);
    }

    const regex = new RegExp(pattern, flags);
    const matches = content.match(regex) || [];

    notifyProgress('search_regex', 'completed', `Found ${matches.length} matches`, { matchCount: matches.length });

    return { success: true, pattern, matchCount: matches.length, matches: matches.slice(0, 100) };
  },

  // 14. Extract JSON
  async extract_json(params = {}) {
    const { page } = requireBrowser();
    const { source = 'page', selector, jsonPath } = params;

    notifyProgress('extract_json', 'started', `Extracting JSON from: ${source}`);

    let jsonData = [];

    if (source === 'ld+json') {
      jsonData = await page.$$eval('script[type="application/ld+json"]', scripts =>
        scripts.map(s => {
          try { return JSON.parse(s.textContent); } catch { return null; }
        }).filter(Boolean)
      );
    } else if (source === 'scripts') {
      const content = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
      const jsonRegex = /\{[^{}]*\}|\[[^\[\]]*\]/g;
      const matches = content.match(jsonRegex) || [];
      jsonData = matches.slice(0, 20).map(m => {
        try { return JSON.parse(m); } catch { return null; }
      }).filter(Boolean);
    } else if (selector) {
      const text = await page.$eval(selector, el => el.textContent);
      try { jsonData = [JSON.parse(text)]; } catch { }
    }

    notifyProgress('extract_json', 'completed', `Extracted ${jsonData.length} JSON objects`, { count: jsonData.length });

    return { success: true, source, count: jsonData.length, data: jsonData };
  },

  // 15. Scrape Meta Tags
  async scrape_meta_tags(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'] } = params;

    notifyProgress('scrape_meta_tags', 'started', 'Extracting meta tags...');

    const meta = await page.evaluate(() => {
      const result = { meta: {}, og: {}, twitter: {} };

      document.querySelectorAll('meta').forEach(tag => {
        const name = tag.getAttribute('name') || tag.getAttribute('property');
        const content = tag.getAttribute('content');
        if (name && content) {
          if (name.startsWith('og:')) {
            result.og[name.replace('og:', '')] = content;
          } else if (name.startsWith('twitter:')) {
            result.twitter[name.replace('twitter:', '')] = content;
          } else {
            result.meta[name] = content;
          }
        }
      });

      result.title = document.title;
      result.canonical = document.querySelector('link[rel="canonical"]')?.href;

      return result;
    });

    const tagCount = Object.keys(meta.meta).length + Object.keys(meta.og).length + Object.keys(meta.twitter).length;
    notifyProgress('scrape_meta_tags', 'completed', `Extracted ${tagCount} meta tags`, { tagCount });

    return { success: true, ...meta };
  },

  // 16. Press Key
  async press_key(params) {
    const { page } = requireBrowser();
    const { key, modifiers = [], count = 1 } = params;

    notifyProgress('press_key', 'started', `Pressing: ${modifiers.length ? modifiers.join('+') + '+' : ''}${key} x${count}`);

    for (let i = 0; i < count; i++) {
      if (modifiers.length > 0) {
        const keyCombo = [...modifiers, key].join('+');
        await page.keyboard.press(keyCombo);
      } else {
        await page.keyboard.press(key);
      }
    }

    notifyProgress('press_key', 'completed', `Pressed ${key} ${count} time(s)`, { key, modifiers, count });

    return { success: true, key, modifiers, count };
  },

  // 17. Progress Tracker
  async progress_tracker(params = {}) {
    const { action = 'get', taskName, progress } = params;

    switch (action) {
      case 'start':
        progressTasks[taskName] = { progress: 0, startTime: Date.now() };
        notifyProgress('progress_tracker', 'started', `Task started: ${taskName}`);
        break;
      case 'update':
        if (progressTasks[taskName]) {
          progressTasks[taskName].progress = progress;
          notifyProgress('progress_tracker', 'progress', `${taskName}: ${progress}%`, { taskName, progress });
        }
        break;
      case 'complete':
        if (progressTasks[taskName]) {
          progressTasks[taskName].progress = 100;
          progressTasks[taskName].endTime = Date.now();
          const duration = progressTasks[taskName].endTime - progressTasks[taskName].startTime;
          notifyProgress('progress_tracker', 'completed', `${taskName} completed in ${duration}ms`, { taskName, duration });
        }
        break;
    }

    return { success: true, tasks: progressTasks };
  },

  // 18. Deep Analysis
  async deep_analysis(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], detailed = true } = params;

    notifyProgress('deep_analysis', 'started', 'Analyzing page...');

    const analysis = await page.evaluate(() => {
      const result = {
        seo: {
          title: document.title,
          titleLength: document.title.length,
          h1Count: document.querySelectorAll('h1').length,
          metaDescription: document.querySelector('meta[name="description"]')?.content,
          canonicalUrl: document.querySelector('link[rel="canonical"]')?.href,
          hasViewport: !!document.querySelector('meta[name="viewport"]')
        },
        performance: {
          domElements: document.querySelectorAll('*').length,
          scripts: document.querySelectorAll('script').length,
          stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
          images: document.querySelectorAll('img').length
        },
        accessibility: {
          imagesWithoutAlt: document.querySelectorAll('img:not([alt])').length,
          linksCount: document.querySelectorAll('a').length,
          formsCount: document.querySelectorAll('form').length,
          inputsWithoutLabel: document.querySelectorAll('input:not([aria-label]):not([id])').length
        },
        security: {
          isHttps: location.protocol === 'https:',
          hasCSP: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
          externalScripts: [...document.querySelectorAll('script[src]')].filter(s => !s.src.includes(location.hostname)).length
        }
      };
      return result;
    });

    notifyProgress('deep_analysis', 'completed', `Analysis complete: ${analysis.performance.domElements} DOM elements`, { domElements: analysis.performance.domElements });

    return { success: true, url: page.url(), analysis };
  },

  // 19. Network Recorder (POWER ENHANCED - API interception + WebSocket recording + media + responses)
  async network_recorder(params = {}) {
    const { page } = requireBrowser();
    const { action = 'get', filter = {}, captureResponses = false } = params;

    switch (action) {
      case 'start':
        networkRecords = [];
        isRecordingNetwork = true;

        // ====== FEATURE 2: Pre-page-load Runtime API Interception ======
        // Inject BEFORE any JS runs — catches calls from obfuscated/webpack code
        try {
          await page.addInitScript(() => {
            window.__interceptedApis = [];
            window.__wsMessages = [];

            // --- Monkey-patch fetch ---
            const origFetch = window.fetch;
            window.fetch = function (...args) {
              try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || String(args[0]));
                const opts = args[1] || {};
                const entry = {
                  type: 'fetch', url, method: opts.method || 'GET',
                  headers: opts.headers ? JSON.parse(JSON.stringify(opts.headers)) : null,
                  body: typeof opts.body === 'string' ? opts.body.substring(0, 2000) : null,
                  timestamp: Date.now()
                };
                window.__interceptedApis.push(entry);
              } catch (e) { }
              return origFetch.apply(this, args);
            };

            // --- Monkey-patch XMLHttpRequest ---
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function (method, url) {
              this.__iUrl = url; this.__iMethod = method; this.__iHeaders = {};
              return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
              if (this.__iHeaders) this.__iHeaders[name] = value;
              return origSetHeader.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (body) {
              try {
                window.__interceptedApis.push({
                  type: 'xhr', url: this.__iUrl, method: this.__iMethod,
                  headers: this.__iHeaders || null,
                  body: typeof body === 'string' ? body.substring(0, 2000) : null,
                  timestamp: Date.now()
                });
              } catch (e) { }
              return origSend.apply(this, arguments);
            };

            // --- Monkey-patch navigator.sendBeacon ---
            if (navigator.sendBeacon) {
              const origBeacon = navigator.sendBeacon.bind(navigator);
              navigator.sendBeacon = function (url, data) {
                try {
                  window.__interceptedApis.push({
                    type: 'beacon', url, method: 'POST',
                    body: typeof data === 'string' ? data.substring(0, 2000) : null,
                    timestamp: Date.now()
                  });
                } catch (e) { }
                return origBeacon(url, data);
              };
            }

            // ====== FEATURE 3: WebSocket Recording ======
            const OrigWS = window.WebSocket;
            window.WebSocket = function (url, protocols) {
              const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
              const wsId = window.__wsMessages.length;
              const wsEntry = { id: wsId, url, openedAt: Date.now(), messages: [], status: 'connecting' };
              window.__wsMessages.push(wsEntry);

              ws.addEventListener('open', () => { wsEntry.status = 'open'; });
              ws.addEventListener('close', (e) => { wsEntry.status = 'closed'; wsEntry.closedAt = Date.now(); wsEntry.closeCode = e.code; });
              ws.addEventListener('error', () => { wsEntry.status = 'error'; });
              ws.addEventListener('message', (e) => {
                try {
                  let data = e.data;
                  let dataType = 'text';
                  if (data instanceof Blob) { dataType = 'blob'; data = `[Blob ${data.size} bytes]`; }
                  else if (data instanceof ArrayBuffer) { dataType = 'binary'; data = `[ArrayBuffer ${data.byteLength} bytes]`; }
                  else if (typeof data === 'string' && data.length > 5000) { data = data.substring(0, 5000) + '...'; }
                  wsEntry.messages.push({ direction: 'received', data, dataType, timestamp: Date.now() });
                } catch (e) { }
              });

              // Intercept send
              const origWsSend = ws.send.bind(ws);
              ws.send = function (data) {
                try {
                  let sendData = data;
                  let dataType = 'text';
                  if (data instanceof Blob) { dataType = 'blob'; sendData = `[Blob ${data.size} bytes]`; }
                  else if (data instanceof ArrayBuffer) { dataType = 'binary'; sendData = `[ArrayBuffer ${data.byteLength} bytes]`; }
                  else if (typeof data === 'string' && data.length > 5000) { sendData = data.substring(0, 5000) + '...'; }
                  wsEntry.messages.push({ direction: 'sent', data: sendData, dataType, timestamp: Date.now() });
                } catch (e) { }
                return origWsSend(data);
              };

              return ws;
            };
            window.WebSocket.prototype = OrigWS.prototype;
            window.WebSocket.CONNECTING = OrigWS.CONNECTING;
            window.WebSocket.OPEN = OrigWS.OPEN;
            window.WebSocket.CLOSING = OrigWS.CLOSING;
            window.WebSocket.CLOSED = OrigWS.CLOSED;
          });
        } catch (e) { /* addInitScript may fail on already-loaded pages, that's OK */ }

        // Request handler
        page.on('request', req => {
          if (isRecordingNetwork) {
            networkRecords.push({
              type: 'request',
              url: req.url(),
              method: req.method(),
              resourceType: req.resourceType(),
              headers: req.headers(),
              timestamp: Date.now()
            });
          }
        });

        // Response handler for capturing video/media URLs
        page.on('response', async res => {
          if (isRecordingNetwork) {
            const url = res.url();
            const contentType = res.headers()['content-type'] || '';
            const isMedia = contentType.includes('video') ||
              contentType.includes('audio') ||
              contentType.includes('mpegurl') ||
              url.includes('.m3u8') ||
              url.includes('.mpd') ||
              url.includes('.mp4') ||
              url.includes('.ts');

            const isApiCall = contentType.includes('json') ||
              contentType.includes('x-www-form-urlencoded') ||
              url.match(/\.(php|api|json|do|action)($|\?)/) ||
              (res.request().resourceType() === 'xhr') ||
              (res.request().resourceType() === 'fetch');

            const record = {
              type: 'response',
              url: url,
              method: res.request().method(),
              status: res.status(),
              contentType: contentType,
              isMedia: isMedia,
              isApiCall: isApiCall,
              resourceType: res.request().resourceType(),
              timestamp: Date.now()
            };

            // For media URLs, try to get more details
            if (isMedia) {
              record.mediaType = url.includes('.m3u8') ? 'hls' :
                url.includes('.mpd') ? 'dash' :
                  url.includes('.mp4') ? 'mp4' : 'other';
            }

            // Capture request/response body for API calls
            if (isApiCall) {
              try {
                const postData = res.request().postData();
                if (postData) record.requestBody = postData.substring(0, 2000);
                const responseBody = await res.text().catch(() => null);
                if (responseBody) {
                  record.responseBody = responseBody.substring(0, 5000);
                  try { record.responseJson = JSON.parse(responseBody); } catch (e) { }
                }
              } catch (e) { }
            }

            networkRecords.push(record);
          }
        });

        // Frame navigation handler for JS redirects
        page.on('framenavigated', frame => {
          if (isRecordingNetwork && frame === page.mainFrame()) {
            networkRecords.push({
              type: 'navigation',
              url: frame.url(),
              timestamp: Date.now()
            });
          }
        });

        notifyProgress('network_recorder', 'started', 'Power recording started (requests + responses + API interception + WebSocket + navigations)');
        break;

      case 'stop':
        isRecordingNetwork = false;
        notifyProgress('network_recorder', 'completed', `Recording stopped: ${networkRecords.length} events captured`);
        break;

      case 'clear':
        networkRecords = [];
        // Also clear intercepted data
        try { await page.evaluate(() => { window.__interceptedApis = []; window.__wsMessages = []; }); } catch (e) { }
        notifyProgress('network_recorder', 'completed', 'Network records cleared');
        break;

      case 'get_media':
        // Special action to get only media URLs
        const mediaRecords = networkRecords.filter(r => r.isMedia);
        return {
          success: true,
          count: mediaRecords.length,
          mediaUrls: mediaRecords.map(r => ({ url: r.url, type: r.mediaType }))
        };

      case 'get_navigations':
        // Get only navigation events (for tracking JS redirects)
        const navRecords = networkRecords.filter(r => r.type === 'navigation');
        return {
          success: true,
          count: navRecords.length,
          navigations: navRecords
        };

      case 'get_api_calls': {
        const apiRecords = networkRecords.filter(r => r.isApiCall);
        return {
          success: true,
          count: apiRecords.length,
          apiCalls: apiRecords.map(r => ({
            url: r.url, method: r.method || 'GET', status: r.status,
            contentType: r.contentType, resourceType: r.resourceType,
            requestBody: r.requestBody || null, responseBody: r.responseBody || null,
            responseJson: r.responseJson || null, timestamp: r.timestamp
          }))
        };
      }

      // ====== FEATURE 2: Get Intercepted APIs (from monkey-patched fetch/XHR/beacon) ======
      case 'get_intercepted_apis': {
        try {
          const intercepted = await page.evaluate(() => window.__interceptedApis || []);
          return {
            success: true,
            count: intercepted.length,
            interceptedApis: intercepted,
            note: 'These are runtime-intercepted API calls captured via monkey-patched fetch/XHR/sendBeacon (pre-page-load injection)'
          };
        } catch (e) {
          return { success: false, error: 'Failed to retrieve intercepted APIs: ' + e.message, interceptedApis: [] };
        }
      }

      // ====== FEATURE 3: Get WebSocket Messages ======
      case 'get_websockets': {
        try {
          const wsData = await page.evaluate(() => window.__wsMessages || []);
          const totalMessages = wsData.reduce((sum, ws) => sum + ws.messages.length, 0);
          return {
            success: true,
            count: wsData.length,
            totalMessages: totalMessages,
            websockets: wsData,
            note: 'WebSocket connections and messages captured via constructor monkey-patch'
          };
        } catch (e) {
          return { success: false, error: 'Failed to retrieve WebSocket data: ' + e.message, websockets: [] };
        }
      }
    }

    let records = networkRecords;
    if (filter.resourceType) {
      records = records.filter(r => r.resourceType === filter.resourceType);
    }
    if (filter.urlPattern) {
      const regex = new RegExp(filter.urlPattern);
      records = records.filter(r => regex.test(r.url));
    }
    if (filter.type) {
      records = records.filter(r => r.type === filter.type);
    }
    if (filter.mediaOnly) {
      records = records.filter(r => r.isMedia);
    }

    return { success: true, recording: isRecordingNetwork, count: records.length, records: records.slice(-200) };
  },

  // 20. Link Harvester (ENHANCED - finds hidden links, data attributes, onclick handlers)
  async link_harvester(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], selector, includeText = true, includeHidden = true, searchIframes = false } = params;

    notifyProgress('link_harvester', 'started', 'Harvesting links (enhanced mode)...');

    const currentHost = new URL(page.url()).hostname;

    // Enhanced link extraction
    const extractLinks = async (context) => {
      return await context.evaluate(({ includeText, includeHidden }) => {
        const allLinks = [];
        const seenUrls = new Set();

        const addLink = (href, text, source, element) => {
          if (!href || seenUrls.has(href)) return;
          if (!href.startsWith('http') && !href.startsWith('//')) return;

          // Handle protocol-relative URLs
          if (href.startsWith('//')) {
            href = window.location.protocol + href;
          }

          seenUrls.add(href);
          allLinks.push({
            href,
            text: includeText ? (text || '').trim().substring(0, 100) : undefined,
            source,
            hidden: element ? (
              element.offsetParent === null ||
              getComputedStyle(element).display === 'none' ||
              getComputedStyle(element).visibility === 'hidden'
            ) : false
          });
        };

        // 1. Standard anchor tags
        document.querySelectorAll('a[href]').forEach(a => {
          addLink(a.href, a.textContent, 'anchor', a);
        });

        // 2. Data attributes containing URLs
        const dataAttrs = ['data-href', 'data-url', 'data-link', 'data-src', 'data-file', 'data-download'];
        dataAttrs.forEach(attr => {
          document.querySelectorAll(`[${attr}]`).forEach(el => {
            const url = el.getAttribute(attr);
            addLink(url, el.textContent, `${attr}`, el);
          });
        });

        // 3. OnClick handlers with URLs
        if (includeHidden) {
          document.querySelectorAll('[onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick');
            // Look for URL patterns in onclick
            const urlMatches = onclick.match(/https?:\/\/[^\s"'<>]+/gi) || [];
            urlMatches.forEach(url => {
              addLink(url, el.textContent, 'onclick', el);
            });

            // Look for location.href assignments
            const hrefMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (hrefMatch) {
              addLink(hrefMatch[1], el.textContent, 'onclick-location', el);
            }

            // Look for window.open calls
            const openMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
            if (openMatch) {
              addLink(openMatch[1], el.textContent, 'onclick-window-open', el);
            }
          });
        }

        // 4. JavaScript href links
        document.querySelectorAll('a[href^="javascript:"]').forEach(a => {
          const href = a.getAttribute('href');
          const urlMatch = href.match(/https?:\/\/[^\s"'<>]+/gi);
          if (urlMatch) {
            urlMatch.forEach(url => addLink(url, a.textContent, 'javascript-href', a));
          }
        });

        // 5. Hidden inputs with URLs
        document.querySelectorAll('input[type="hidden"]').forEach(input => {
          const value = input.value;
          if (value && (value.startsWith('http') || value.startsWith('//'))) {
            addLink(value, input.name || input.id, 'hidden-input', input);
          }
        });

        // 6. Script content analysis for URLs (limited for performance)
        if (includeHidden) {
          const scripts = [...document.querySelectorAll('script')].slice(0, 20);
          scripts.forEach(script => {
            const content = script.textContent || '';
            // Look for download/stream URLs
            const patterns = [
              /["']?(https?:\/\/[^"'\s<>]+\.(mp4|mkv|avi|m3u8|mpd|zip|rar|pdf))[^"'\s<>]*["']?/gi,
              /download[_-]?url\s*[:=]\s*["']([^"']+)["']/gi,
              /file\s*[:=]\s*["']([^"']+)["']/gi
            ];

            patterns.forEach(pattern => {
              let match;
              while ((match = pattern.exec(content)) !== null) {
                addLink(match[1], 'script-extracted', 'script', null);
              }
            });
          });
        }

        // 7. Meta refresh URLs
        const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
        if (metaRefresh) {
          const content = metaRefresh.getAttribute('content');
          const urlMatch = content?.match(/url=(.+)/i);
          if (urlMatch) {
            addLink(urlMatch[1].trim().replace(/['"]/g, ''), 'meta-refresh', 'meta', null);
          }
        }

        // 8. Iframe sources
        document.querySelectorAll('iframe[src]').forEach(iframe => {
          addLink(iframe.src, 'iframe', 'iframe', iframe);
        });

        return allLinks;
      }, { includeText, includeHidden }).catch(() => []);
    };

    let links = await extractLinks(page);

    // Search iframes if enabled
    if (searchIframes) {
      const frames = page.frames();
      for (let i = 1; i < frames.length && i < 5; i++) {
        try {
          const frame = frames[i];
          if (frame.url() && frame.url() !== 'about:blank') {
            const frameLinks = await extractLinks(frame);
            frameLinks.forEach(link => link.source = `iframe:${link.source}`);
            links = [...links, ...frameLinks];
          }
        } catch (e) { }
      }
    }

    // Filter by type
    if (!types.includes('all')) {
      links = links.filter(link => {
        const isInternal = link.href.includes(currentHost);
        const isMedia = /\.(jpg|jpeg|png|gif|mp4|mp3|mkv|avi|pdf|zip|rar|m3u8|mpd)/i.test(link.href);
        const isDownload = /download|file|drive/i.test(link.href);

        if (types.includes('internal') && isInternal) return true;
        if (types.includes('external') && !isInternal) return true;
        if (types.includes('media') && isMedia) return true;
        if (types.includes('download') && isDownload) return true;
        if (types.includes('hidden') && link.hidden) return true;
        return false;
      });
    }

    // Remove hidden links if not requested
    if (!includeHidden) {
      links = links.filter(link => !link.hidden);
    }

    // Deduplicate
    const seen = new Set();
    links = links.filter(link => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });

    notifyProgress('link_harvester', 'completed', `Found ${links.length} links (including hidden)`, { count: links.length });

    return { success: true, count: links.length, links };
  },

  // 21. Cookie Manager
  async cookie_manager(params = {}) {
    const { page } = requireBrowser();
    const { action = 'get', name, value, domain, expires } = params;

    notifyProgress('cookie_manager', 'started', `Cookie action: ${action}`);

    switch (action) {
      case 'get':
        const cookies = await page.cookies();
        notifyProgress('cookie_manager', 'completed', `Retrieved ${cookies.length} cookies`);
        return { success: true, cookies: name ? cookies.filter(c => c.name === name) : cookies };

      case 'set':
        await page.setCookie({ name, value, domain: domain || new URL(page.url()).hostname, expires });
        notifyProgress('cookie_manager', 'completed', `Cookie set: ${name}`);
        return { success: true, message: `Cookie ${name} set` };

      case 'delete':
        const toDelete = await page.cookies();
        const filtered = name ? toDelete.filter(c => c.name === name) : toDelete;
        await page.deleteCookie(...filtered);
        notifyProgress('cookie_manager', 'completed', `Deleted ${filtered.length} cookie(s)`);
        return { success: true, message: `Deleted ${filtered.length} cookie(s)` };

      case 'clear':
        const allCookies = await page.cookies();
        await page.deleteCookie(...allCookies);
        notifyProgress('cookie_manager', 'completed', `Cleared ${allCookies.length} cookies`);
        return { success: true, message: `Cleared ${allCookies.length} cookies` };
    }

    return { success: false, error: 'Invalid action' };
  },

  // 22. File Downloader
  async file_downloader(params) {
    const { page } = requireBrowser();
    const { url, filename, directory = './downloads' } = params;

    notifyProgress('file_downloader', 'started', `Downloading: ${url}`);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const response = await page.goto(url, { waitUntil: 'networkidle2' });
    const buffer = await response.buffer();

    const outputFilename = filename || path.basename(new URL(url).pathname) || 'download';
    const outputPath = path.join(directory, outputFilename);

    fs.writeFileSync(outputPath, buffer);

    notifyProgress('file_downloader', 'completed', `Downloaded: ${outputFilename} (${buffer.length} bytes)`, { filename: outputPath, size: buffer.length });

    return { success: true, filename: outputPath, size: buffer.length };
  },

  // 23. iFrame Handler
  async iframe_handler(params = {}) {
    const { page } = requireBrowser();
    const { action = 'list', selector, index } = params;

    notifyProgress('iframe_handler', 'started', `iFrame action: ${action}`);

    const frames = page.frames();

    switch (action) {
      case 'list':
        notifyProgress('iframe_handler', 'completed', `Found ${frames.length} frames`);
        return {
          success: true,
          count: frames.length,
          frames: frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }))
        };

      case 'switch':
        const targetFrame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index];

        if (targetFrame) {
          notifyProgress('iframe_handler', 'completed', `Switched to frame: ${targetFrame.url()}`);
          return { success: true, switched: true, url: targetFrame.url() };
        }
        notifyProgress('iframe_handler', 'error', 'Frame not found');
        return { success: false, error: 'Frame not found' };

      case 'content':
        const frame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index || 0];

        if (frame) {
          const content = await frame.content();
          notifyProgress('iframe_handler', 'completed', `Got frame content: ${content.length} chars`);
          return { success: true, content };
        }
        return { success: false, error: 'Frame not found' };

      case 'exit':
        notifyProgress('iframe_handler', 'completed', 'Returned to main frame');
        return { success: true, message: 'Returned to main frame' };
    }

    return { success: false, error: 'Invalid action' };
  },

  // 24. Stream Extractor (ENHANCED - searches iframes, detects obfuscated sources)
  async stream_extractor(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], quality = 'best', searchIframes = true, deep = true } = params;

    notifyProgress('stream_extractor', 'started', 'Extracting streams (enhanced mode)...');

    // Helper function to extract streams from a frame/page context
    const extractFromContext = async (context, contextName = 'main') => {
      return await context.evaluate(() => {
        const result = { video: [], audio: [], hls: [], dash: [], download: [], embedded: [] };

        // 1. Direct video/audio elements
        document.querySelectorAll('video source, video').forEach(el => {
          const src = el.src || el.getAttribute('src') || el.currentSrc;
          if (src && src.startsWith('http')) result.video.push({ src, type: el.type || 'video' });
        });

        document.querySelectorAll('audio source, audio').forEach(el => {
          const src = el.src || el.getAttribute('src');
          if (src && src.startsWith('http')) result.audio.push({ src, type: el.type || 'audio' });
        });

        // 2. Script content analysis for HLS/DASH/MP4
        const scripts = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
        const html = document.documentElement.innerHTML;
        const combined = scripts + html;

        // HLS streams
        const hlsMatches = combined.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
        result.hls = [...new Set(hlsMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'hls' }));

        // DASH streams
        const dashMatches = combined.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/gi) || [];
        result.dash = [...new Set(dashMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'dash' }));

        // Direct MP4/video links
        const mp4Matches = combined.match(/https?:\/\/[^\s"'<>]+\.(mp4|mkv|avi|webm)[^\s"'<>]*/gi) || [];
        result.download = [...new Set(mp4Matches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'direct' }));

        // 3. Data attributes and hidden sources
        document.querySelectorAll('[data-src], [data-video], [data-url], [data-file]').forEach(el => {
          const dataSrc = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.file;
          if (dataSrc && dataSrc.startsWith('http')) {
            result.video.push({ src: dataSrc, type: 'data-attribute' });
          }
        });

        // 4. Embedded player iframes (just URLs, not content)
        document.querySelectorAll('iframe[src]').forEach(el => {
          const src = el.src;
          if (src && src.startsWith('http')) {
            result.embedded.push({ src, type: 'iframe' });
          }
        });

        // 5. JWPlayer / VideoJS / Plyr sources
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            const playlist = jw.getPlaylist?.() || [];
            playlist.forEach(item => {
              if (item.file) result.video.push({ src: item.file, type: 'jwplayer' });
              (item.sources || []).forEach(s => {
                if (s.file) result.video.push({ src: s.file, type: 'jwplayer-source' });
              });
            });
          } catch (e) { }
        }

        if (window.player && window.player.src) {
          try {
            const src = typeof window.player.src === 'function' ? window.player.src() : window.player.src;
            if (src) result.video.push({ src, type: 'player-api' });
          } catch (e) { }
        }

        // 6. Look for common piracy site patterns
        const patterns = [
          /file\s*:\s*["']([^"']+)["']/gi,
          /source\s*:\s*["']([^"']+)["']/gi,
          /src\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv))["']/gi,
          /url\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/gi,
          /video_url\s*=\s*["']([^"']+)["']/gi,
          /sources\s*:\s*\[([^\]]+)\]/gi
        ];

        patterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(combined)) !== null) {
            const url = match[1];
            if (url && url.startsWith('http') && (url.includes('.mp4') || url.includes('.m3u8'))) {
              result.download.push({ src: url, type: 'pattern-match' });
            }
          }
        });

        return result;
      }).catch(() => ({ video: [], audio: [], hls: [], dash: [], download: [], embedded: [] }));
    };

    // Extract from main page
    const mainStreams = await extractFromContext(page, 'main');
    let allStreams = { ...mainStreams };

    // Search in iframes if enabled
    if (searchIframes) {
      const frames = page.frames();
      notifyProgress('stream_extractor', 'progress', `Searching ${frames.length} frames...`);

      for (let i = 1; i < frames.length && i < 10; i++) { // Limit to 10 frames
        try {
          const frame = frames[i];
          const frameUrl = frame.url();
          if (frameUrl && frameUrl !== 'about:blank') {
            const frameStreams = await extractFromContext(frame, `frame-${i}`);

            // Merge frame streams
            Object.keys(frameStreams).forEach(key => {
              if (Array.isArray(frameStreams[key])) {
                frameStreams[key].forEach(stream => {
                  stream.source = `iframe: ${frameUrl}`;
                });
                allStreams[key] = [...(allStreams[key] || []), ...frameStreams[key]];
              }
            });
          }
        } catch (e) {
          // Frame access error, skip
        }
      }
    }

    // Deduplicate by URL
    Object.keys(allStreams).forEach(key => {
      if (Array.isArray(allStreams[key])) {
        const seen = new Set();
        allStreams[key] = allStreams[key].filter(item => {
          if (seen.has(item.src)) return false;
          seen.add(item.src);
          return true;
        });
      }
    });

    const totalStreams = Object.values(allStreams).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    notifyProgress('stream_extractor', 'completed', `Found ${totalStreams} streams (including iframes)`, { totalStreams });

    return { success: true, streams: allStreams, totalCount: totalStreams };
  },

  // 25. JS Scrape
  async js_scrape(params) {
    const { page } = requireBrowser();
    const { selector, waitForJS = true, timeout = 10000 } = params;

    notifyProgress('js_scrape', 'started', `Scraping: ${selector}`);

    if (waitForJS) {
      await page.waitForSelector(selector, { timeout });
      notifyProgress('js_scrape', 'progress', 'Element found, extracting content...');
    }

    const content = await page.$eval(selector, el => ({
      html: el.outerHTML,
      text: el.innerText,
      attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value]))
    }));

    notifyProgress('js_scrape', 'completed', `Scraped ${content.text.length} characters`, { selector });

    return { success: true, selector, content };
  },

  // 26. Execute JS (ENHANCED: iframe context support - FIXED)
  async execute_js(params) {
    const { page } = requireBrowser();
    const {
      code,
      returnValue = true,
      // NEW: iframe support (FIXED)
      iframe,
      iframeSelector,
      waitForIframe = true,
      timeout = 30000
    } = params;

    notifyProgress('execute_js', 'started', `Executing JavaScript...${iframe !== undefined ? ` (iframe ${iframe})` : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;

    if (iframe !== undefined || iframeSelector) {
      try {
        const frames = page.frames();

        if (iframe !== undefined) {
          // iframe index provided
          if (iframe === 0) {
            // index 0 = main frame
            context = page.mainFrame();
            frameInfo = { index: 0, url: page.url(), isMain: true };
          } else if (frames[iframe]) {
            context = frames[iframe];
            frameInfo = { index: iframe, url: frames[iframe].url() };
            notifyProgress('execute_js', 'progress', `Switched to iframe ${iframe}: ${frames[iframe].url().substring(0, 50)}...`);
          } else {
            notifyProgress('execute_js', 'error', `iframe index ${iframe} not found. Total frames: ${frames.length}`);
            return { success: false, error: `iframe index ${iframe} not found. Available: 0-${frames.length - 1}` };
          }
        } else if (iframeSelector) {
          // Find iframe by selector
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame;
              frameInfo = { selector: iframeSelector, url: frame.url() };
              notifyProgress('execute_js', 'progress', `Switched to iframe by selector: ${iframeSelector}`);
            }
          } else {
            return { success: false, error: `iframe selector not found: ${iframeSelector}` };
          }
        }

        // Wait for iframe to be ready if needed
        if (waitForIframe && context !== page) {
          try {
            await context.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
          } catch (e) {
            notifyProgress('execute_js', 'progress', 'Warning: iframe may not be fully loaded');
          }
        }

      } catch (e) {
        notifyProgress('execute_js', 'error', `iframe switch failed: ${e.message}`);
        return { success: false, error: `iframe switch failed: ${e.message}` };
      }
    }

    try {
      // Execute the code in the correct context
      const result = await context.evaluate(code);

      notifyProgress('execute_js', 'completed', 'JavaScript executed', {
        hasResult: result !== undefined,
        iframe: frameInfo
      });

      return { success: true, result: returnValue ? result : undefined, iframe: frameInfo };

    } catch (evalError) {
      notifyProgress('execute_js', 'error', `Execution error: ${evalError.message}`);
      return { success: false, error: evalError.message, iframe: frameInfo };
    }
  },

  // 27. Player API Hook (ENHANCED - searches iframes, detects more player types)
  async player_api_hook(params = {}) {
    const { page } = requireBrowser();
    const { playerType = 'auto', action = 'info', searchIframes = true } = params;

    notifyProgress('player_api_hook', 'started', `Player ${action}: ${playerType}`);

    // Enhanced player detection function
    const detectPlayer = async (context, contextName = 'main') => {
      return await context.evaluate(({ playerType, action }) => {
        const result = {
          detected: false,
          type: null,
          sources: [],
          info: {}
        };

        // 1. JWPlayer detection
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            if (jw) {
              result.detected = true;
              result.type = 'jwplayer';
              result.info = {
                duration: jw.getDuration?.(),
                currentTime: jw.getPosition?.(),
                volume: jw.getVolume?.(),
                state: jw.getState?.()
              };

              if (action === 'sources') {
                const playlist = jw.getPlaylist?.() || [];
                playlist.forEach(item => {
                  if (item.file) result.sources.push({ src: item.file, type: 'jwplayer' });
                  (item.sources || []).forEach(s => {
                    if (s.file) result.sources.push({ src: s.file, type: 'jwplayer-source', label: s.label });
                  });
                });
              }

              if (action === 'play') jw.play?.();
              if (action === 'pause') jw.pause?.();
            }
          } catch (e) { }
        }

        // 2. Video.js detection
        if (window.videojs && !result.detected) {
          try {
            const players = document.querySelectorAll('.video-js');
            if (players.length > 0) {
              const player = window.videojs(players[0].id || players[0]);
              result.detected = true;
              result.type = 'videojs';
              result.info = {
                duration: player.duration?.(),
                currentTime: player.currentTime?.(),
                volume: player.volume?.()
              };

              if (action === 'sources') {
                const src = player.currentSrc?.();
                if (src) result.sources.push({ src, type: 'videojs' });
              }

              if (action === 'play') player.play?.();
              if (action === 'pause') player.pause?.();
            }
          } catch (e) { }
        }

        // 3. Plyr detection
        if (window.Plyr && !result.detected) {
          try {
            const plyrElements = document.querySelectorAll('.plyr');
            if (plyrElements.length > 0 && plyrElements[0].plyr) {
              const player = plyrElements[0].plyr;
              result.detected = true;
              result.type = 'plyr';
              result.info = {
                duration: player.duration,
                currentTime: player.currentTime,
                volume: player.volume
              };

              if (action === 'sources') {
                const src = player.source;
                if (src) result.sources.push({ src, type: 'plyr' });
              }
            }
          } catch (e) { }
        }

        // 4. Generic window.player
        if ((window.player || window.videoPlayer) && !result.detected) {
          try {
            const player = window.player || window.videoPlayer;
            result.detected = true;
            result.type = 'generic';
            result.info = {
              duration: player.getDuration?.() || player.duration,
              currentTime: player.getCurrentTime?.() || player.currentTime,
              volume: player.getVolume?.() || player.volume
            };

            if (action === 'sources') {
              const sources = player.getSources?.() || player.getPlaylist?.() || [];
              sources.forEach(s => {
                if (s.file || s.src) result.sources.push({ src: s.file || s.src, type: 'generic' });
              });
            }
          } catch (e) { }
        }

        // 5. HTML5 Video fallback
        if (!result.detected) {
          const video = document.querySelector('video');
          if (video) {
            result.detected = true;
            result.type = 'html5';
            result.info = {
              duration: video.duration,
              currentTime: video.currentTime,
              volume: video.volume,
              paused: video.paused,
              src: video.src || video.currentSrc
            };

            if (action === 'sources') {
              if (video.src) result.sources.push({ src: video.src, type: 'html5' });
              if (video.currentSrc && video.currentSrc !== video.src) {
                result.sources.push({ src: video.currentSrc, type: 'html5-current' });
              }
              video.querySelectorAll('source').forEach(s => {
                if (s.src) result.sources.push({ src: s.src, type: 'html5-source' });
              });
            }

            if (action === 'play') video.play();
            if (action === 'pause') video.pause();
          }
        }

        // 6. Look for common obfuscated player variables
        const commonPlayerVars = ['player', 'videoPlayer', 'mediaPlayer', 'vPlayer', 'hls', 'flv'];
        for (const varName of commonPlayerVars) {
          if (window[varName] && !result.detected) {
            try {
              const p = window[varName];
              if (typeof p === 'object' && (p.play || p.getDuration || p.src)) {
                result.detected = true;
                result.type = `${varName}-object`;
                result.info = { raw: true };
              }
            } catch (e) { }
          }
        }

        return result;
      }, { playerType, action }).catch(() => ({ detected: false }));
    };

    // Try main page first
    let playerInfo = await detectPlayer(page, 'main');

    // Search iframes if no player found and searchIframes is enabled
    if (!playerInfo.detected && searchIframes) {
      const frames = page.frames();
      notifyProgress('player_api_hook', 'progress', `Searching ${frames.length} frames for player...`);

      for (let i = 1; i < frames.length && i < 10; i++) {
        try {
          const frame = frames[i];
          const frameUrl = frame.url();
          if (frameUrl && frameUrl !== 'about:blank') {
            const framePlayer = await detectPlayer(frame, `frame-${i}`);
            if (framePlayer.detected) {
              playerInfo = { ...framePlayer, frameSource: frameUrl };
              notifyProgress('player_api_hook', 'progress', `Found player in iframe: ${frameUrl}`);
              break;
            }
          }
        } catch (e) {
          // Frame access error, skip
        }
      }
    }

    notifyProgress('player_api_hook', 'completed',
      playerInfo.detected ? `Player detected: ${playerInfo.type}${playerInfo.frameSource ? ' (in iframe)' : ''}` : 'No player found',
      { detected: playerInfo.detected, type: playerInfo.type });

    return { success: true, ...playerInfo };
  },

  // 28. Form Automator
  async form_automator(params) {
    const { page } = requireBrowser();
    const { selector, data, submit = false, humanLike = true } = params;

    const formSelector = selector || 'form';
    const fields = Object.keys(data || {});

    notifyProgress('form_automator', 'started', `Filling form with ${fields.length} fields`);

    let filledCount = 0;

    for (const [field, value] of Object.entries(data || {})) {
      const inputSelector = `${formSelector} [name="${field}"], ${formSelector} #${field}, ${formSelector} [placeholder*="${field}" i]`;

      try {
        const input = await page.$(inputSelector);
        if (input) {
          const tagName = await input.evaluate(el => el.tagName.toLowerCase());
          const inputType = await input.evaluate(el => el.type);

          if (tagName === 'select') {
            await page.select(inputSelector, value);
          } else if (inputType === 'checkbox' || inputType === 'radio') {
            if (value) await input.click();
          } else {
            await input.click({ clickCount: 3 });
            if (humanLike) {
              await page.type(inputSelector, String(value), { delay: 50 + Math.random() * 50 });
            } else {
              await page.type(inputSelector, String(value));
            }
          }
          filledCount++;
          notifyProgress('form_automator', 'progress', `Filled: ${field}`, { field, filledCount });
        }
      } catch (e) {
        // Field not found, continue
      }
    }

    if (submit) {
      await page.click(`${formSelector} [type="submit"], ${formSelector} button`);
      notifyProgress('form_automator', 'progress', 'Form submitted');
    }

    notifyProgress('form_automator', 'completed', `Filled ${filledCount}/${fields.length} fields`, { filledCount, submitted: submit });

    return { success: true, formSelector, fieldsProcessed: filledCount, submitted: submit };
  },

  // 21. Media Extractor (MERGED: iframe_handler + stream_extractor + player_api_hook + decoders)
  async media_extractor(params = {}) {
    const { page } = requireBrowser();
    const {
      action = 'extract',
      types = ['all'],
      quality = 'best',
      searchIframes = true,
      deep = true,
      selector,
      index,
      playerAction = 'info',
      encodedData,
      decoderType = 'auto',
      aesKey,
      aesIV,
      urls,
      aiOptimize = true
    } = params;

    notifyProgress('media_extractor', 'started', `Media extraction action: ${action}`);

    // Helper: Extract streams from a context
    const extractStreamsFromContext = async (context, contextName = 'main') => {
      return await context.evaluate(() => {
        const result = { video: [], audio: [], hls: [], dash: [], download: [], embedded: [] };

        // 1. Direct video/audio elements
        document.querySelectorAll('video source, video').forEach(el => {
          const src = el.src || el.getAttribute('src') || el.currentSrc;
          if (src && src.startsWith('http')) result.video.push({ src, type: el.type || 'video' });
        });

        document.querySelectorAll('audio source, audio').forEach(el => {
          const src = el.src || el.getAttribute('src');
          if (src && src.startsWith('http')) result.audio.push({ src, type: el.type || 'audio' });
        });

        // 2. Script content analysis for HLS/DASH/MP4
        const scripts = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
        const html = document.documentElement.innerHTML;
        const combined = scripts + html;

        // HLS streams
        const hlsMatches = combined.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
        result.hls = [...new Set(hlsMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'hls' }));

        // DASH streams
        const dashMatches = combined.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/gi) || [];
        result.dash = [...new Set(dashMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'dash' }));

        // Direct MP4/video links
        const mp4Matches = combined.match(/https?:\/\/[^\s"'<>]+\.(mp4|mkv|avi|webm)[^\s"'<>]*/gi) || [];
        result.download = [...new Set(mp4Matches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'direct' }));

        // 3. Data attributes and hidden sources
        document.querySelectorAll('[data-src], [data-video], [data-url], [data-file]').forEach(el => {
          const dataSrc = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.file;
          if (dataSrc && dataSrc.startsWith('http')) {
            result.video.push({ src: dataSrc, type: 'data-attribute' });
          }
        });

        // 4. Embedded player iframes
        document.querySelectorAll('iframe[src]').forEach(el => {
          const src = el.src;
          if (src && src.startsWith('http')) {
            result.embedded.push({ src, type: 'iframe' });
          }
        });

        // 5. JWPlayer / VideoJS / Plyr sources
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            const playlist = jw.getPlaylist?.() || [];
            playlist.forEach(item => {
              if (item.file) result.video.push({ src: item.file, type: 'jwplayer' });
              (item.sources || []).forEach(s => {
                if (s.file) result.video.push({ src: s.file, type: 'jwplayer-source' });
              });
            });
          } catch (e) { }
        }

        if (window.player && window.player.src) {
          try {
            const src = typeof window.player.src === 'function' ? window.player.src() : window.player.src;
            if (src) result.video.push({ src, type: 'player-api' });
          } catch (e) { }
        }

        // 6. Look for common patterns
        const patterns = [
          /file\s*:\s*["']([^"']+)["']/gi,
          /source\s*:\s*["']([^"']+)["']/gi,
          /src\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv))["']/gi,
          /url\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/gi,
          /video_url\s*=\s*["']([^"']+)["']/gi,
          /sources\s*:\s*\[([^\]]+)\]/gi
        ];

        patterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(combined)) !== null) {
            const url = match[1];
            if (url && url.startsWith('http') && (url.includes('.mp4') || url.includes('.m3u8'))) {
              result.download.push({ src: url, type: 'pattern-match' });
            }
          }
        });

        return result;
      }).catch(() => ({ video: [], audio: [], hls: [], dash: [], download: [], embedded: [] }));
    };

    // Helper: Detect player in context
    const detectPlayer = async (context, contextName = 'main') => {
      return await context.evaluate((playerAction) => {
        const result = { detected: false, type: null, sources: [], info: {} };

        // 1. JWPlayer detection
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            if (jw) {
              result.detected = true;
              result.type = 'jwplayer';
              result.info = {
                duration: jw.getDuration?.(),
                currentTime: jw.getPosition?.(),
                volume: jw.getVolume?.(),
                state: jw.getState?.()
              };

              if (playerAction === 'sources') {
                const playlist = jw.getPlaylist?.() || [];
                playlist.forEach(item => {
                  if (item.file) result.sources.push({ src: item.file, type: 'jwplayer' });
                  (item.sources || []).forEach(s => {
                    if (s.file) result.sources.push({ src: s.file, type: 'jwplayer-source', label: s.label });
                  });
                });
              }

              if (playerAction === 'play') jw.play?.();
              if (playerAction === 'pause') jw.pause?.();
              if (playerAction === 'seek' && params.seekTime) jw.seek?.(params.seekTime);
            }
          } catch (e) { }
        }

        // 2. Video.js detection
        if (window.videojs && !result.detected) {
          try {
            const players = document.querySelectorAll('.video-js');
            if (players.length > 0) {
              const player = window.videojs(players[0].id || players[0]);
              result.detected = true;
              result.type = 'videojs';
              result.info = { duration: player.duration?.(), currentTime: player.currentTime?.(), volume: player.volume?.() };

              if (playerAction === 'sources') {
                const src = player.currentSrc?.();
                if (src) result.sources.push({ src, type: 'videojs' });
              }

              if (playerAction === 'play') player.play?.();
              if (playerAction === 'pause') player.pause?.();
              if (playerAction === 'seek' && params.seekTime) player.currentTime?.(params.seekTime);
            }
          } catch (e) { }
        }

        // 3. Plyr detection
        if (window.Plyr && !result.detected) {
          try {
            const plyrElements = document.querySelectorAll('.plyr');
            if (plyrElements.length > 0 && plyrElements[0].plyr) {
              const player = plyrElements[0].plyr;
              result.detected = true;
              result.type = 'plyr';
              result.info = { duration: player.duration, currentTime: player.currentTime, volume: player.volume };

              if (playerAction === 'sources') {
                const src = player.source;
                if (src) result.sources.push({ src, type: 'plyr' });
              }

              if (playerAction === 'play') player.play?.();
              if (playerAction === 'pause') player.pause?.();
            }
          } catch (e) { }
        }

        // 4. Generic window.player
        if ((window.player || window.videoPlayer) && !result.detected) {
          try {
            const player = window.player || window.videoPlayer;
            result.detected = true;
            result.type = 'generic';
            result.info = {
              duration: player.getDuration?.() || player.duration,
              currentTime: player.getCurrentTime?.() || player.currentTime,
              volume: player.getVolume?.() || player.volume
            };

            if (playerAction === 'sources') {
              const sources = player.getSources?.() || player.getPlaylist?.() || [];
              sources.forEach(s => {
                if (s.file || s.src) result.sources.push({ src: s.file || s.src, type: 'generic' });
              });
            }
          } catch (e) { }
        }

        // 5. HTML5 Video fallback
        if (!result.detected) {
          const video = document.querySelector('video');
          if (video) {
            result.detected = true;
            result.type = 'html5';
            result.info = { duration: video.duration, currentTime: video.currentTime, volume: video.volume, paused: video.paused, src: video.src || video.currentSrc };

            if (playerAction === 'sources') {
              if (video.src) result.sources.push({ src: video.src, type: 'html5' });
              video.querySelectorAll('source').forEach(s => { if (s.src) result.sources.push({ src: s.src, type: 'html5-source' }); });
            }

            if (playerAction === 'play') video.play();
            if (playerAction === 'pause') video.pause();
            if (playerAction === 'seek' && params.seekTime) video.currentTime = params.seekTime;
          }
        }

        return result;
      }, playerAction).catch(() => ({ detected: false }));
    };

    // Helper: Deduplicate streams
    const deduplicateStreams = (streams) => {
      Object.keys(streams).forEach(key => {
        if (Array.isArray(streams[key])) {
          const seen = new Set();
          streams[key] = streams[key].filter(item => {
            if (seen.has(item.src)) return false;
            seen.add(item.src);
            return true;
          });
        }
      });
      return streams;
    };

    // Helper: Auto-detect decoder type
    const autoDetectDecoder = (data) => {
      if (data.includes('%')) return 'url';
      if (/^[A-Za-z0-9+/=]+$/.test(data) && data.length % 4 === 0) return 'base64';
      return 'url';
    };

    switch (action) {
      case 'extract': {
        // Comprehensive extraction - streams, iframes, and players
        notifyProgress('media_extractor', 'progress', 'Extracting all media...');

        // Get iframes
        const frames = page.frames();
        const iframes = frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }));

        // Extract streams from main page
        let allStreams = await extractStreamsFromContext(page, 'main');

        // Search in iframes
        if (searchIframes) {
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const frameStreams = await extractStreamsFromContext(frame, `frame-${i}`);
                Object.keys(frameStreams).forEach(key => {
                  if (Array.isArray(frameStreams[key])) {
                    frameStreams[key].forEach(stream => { stream.source = `iframe: ${frameUrl}`; });
                    allStreams[key] = [...(allStreams[key] || []), ...frameStreams[key]];
                  }
                });
              }
            } catch (e) { }
          }
        }

        // Deduplicate
        allStreams = deduplicateStreams(allStreams);

        // Detect players
        let playerInfo = await detectPlayer(page, 'main');
        if (!playerInfo.detected && searchIframes) {
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const framePlayer = await detectPlayer(frame, `frame-${i}`);
                if (framePlayer.detected) {
                  playerInfo = { ...framePlayer, frameSource: frameUrl };
                  break;
                }
              }
            } catch (e) { }
          }
        }

        const totalStreams = Object.values(allStreams).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        notifyProgress('media_extractor', 'completed', `Extracted ${totalStreams} streams, ${iframes.length} iframes, player: ${playerInfo.detected ? playerInfo.type : 'none'}`);

        return {
          success: true,
          action: 'extract',
          streams: allStreams,
          iframes,
          player: playerInfo,
          totalStreams,
          iframeCount: iframes.length
        };
      }

      case 'list_iframes': {
        const frames = page.frames();
        const iframes = frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }));
        notifyProgress('media_extractor', 'completed', `Found ${iframes.length} iframes`);
        return { success: true, action: 'list_iframes', count: iframes.length, iframes };
      }

      case 'switch_iframe': {
        const frames = page.frames();
        const targetFrame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index];

        if (targetFrame) {
          notifyProgress('media_extractor', 'completed', `Switched to iframe: ${targetFrame.url()}`);
          return { success: true, action: 'switch_iframe', switched: true, url: targetFrame.url(), frameIndex: index };
        }
        notifyProgress('media_extractor', 'error', 'Iframe not found');
        return { success: false, error: 'Iframe not found' };
      }

      case 'player_control': {
        const { playerType, seekTime, volume } = params;
        notifyProgress('media_extractor', 'progress', `Player control: ${playerAction}`);

        // Try main page first
        let result = await detectPlayer(page, 'main');

        // Search iframes if no player found
        if (!result.detected && searchIframes) {
          const frames = page.frames();
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const frameResult = await detectPlayer(frame, `frame-${i}`);
                if (frameResult.detected) {
                  result = { ...frameResult, frameSource: frameUrl };
                  break;
                }
              }
            } catch (e) { }
          }
        }

        notifyProgress('media_extractor', 'completed', result.detected ? `Player ${playerAction} executed: ${result.type}` : 'No player found');
        return { success: true, action: 'player_control', playerAction, ...result };
      }

      case 'decode_url': {
        if (!encodedData) {
          return { success: false, error: 'encodedData is required for decode_url action' };
        }

        const type = decoderType === 'auto' ? autoDetectDecoder(encodedData) : decoderType;
        let decoded;

        notifyProgress('media_extractor', 'progress', `Decoding with ${type}...`);

        switch (type) {
          case 'url':
            decoded = decoders.urlDecode(encodedData);
            break;
          case 'base64':
            decoded = decoders.base64Decode(encodedData);
            break;
          case 'aes':
            if (!aesKey) {
              return { success: false, error: 'aesKey is required for AES decryption' };
            }
            decoded = decoders.decryptAES(encodedData, aesKey, aesIV);
            break;
          default:
            decoded = { success: false, error: 'Unknown decoder type' };
        }

        notifyProgress('media_extractor', 'completed', decoded.success ? 'Decoding successful' : 'Decoding failed');
        return { success: decoded.success, action: 'decode_url', decoderType: type, ...decoded };
      }

      case 'batch_extract': {
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return { success: false, error: 'urls array is required for batch_extract action' };
        }

        notifyProgress('media_extractor', 'progress', `Batch extracting from ${urls.length} URLs...`);

        const results = [];
        const errors = [];

        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          try {
            notifyProgress('media_extractor', 'progress', `Processing ${i + 1}/${urls.length}: ${url}`);

            // Navigate to URL
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForTimeout(2000); // Wait for media to load

            // Extract streams
            const streams = await extractStreamsFromContext(page, 'main');
            const dedupedStreams = deduplicateStreams(streams);
            const totalCount = Object.values(dedupedStreams).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

            // Get page metadata
            const meta = await page.evaluate(() => ({
              title: document.title,
              url: window.location.href
            }));

            results.push({
              url,
              success: true,
              streams: dedupedStreams,
              totalCount,
              title: meta.title,
              finalUrl: meta.url
            });
          } catch (error) {
            errors.push({ url, error: error.message });
            results.push({ url, success: false, error: error.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        notifyProgress('media_extractor', 'completed', `Batch extraction complete: ${successCount}/${urls.length} successful`);

        return {
          success: true,
          action: 'batch_extract',
          totalUrls: urls.length,
          successful: successCount,
          failed: urls.length - successCount,
          results,
          errors
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}. Supported: extract, list_iframes, switch_iframe, player_control, decode_url, batch_extract` };
    }
  },

  // 22. Extract Data (MERGED: search_regex + extract_json + scrape_meta_tags)
  async extract_data(params = {}) {
    const { page } = requireBrowser();
    const {
      type = 'auto',
      pattern,
      selector,
      jsonPath,
      source = 'all',
      autoDecode = true,
      flags = 'gi',
      types = ['all'],
      includeTitle = true,
      includeCanonical = true,
      maxMatches = 100,
      maxJsonObjects = 50,
      waitForSelector = false,
      selectorTimeout = 10000
    } = params;

    notifyProgress('extract_data', 'started', `Extracting data (type: ${type})...`);

    const results = {
      success: true,
      type,
      url: page.url(),
      extracted: {}
    };

    // Helper: Extract regex matches
    const extractRegex = async (regexPattern, regexFlags, contentSource) => {
      let content;
      if (contentSource === 'html') {
        content = await page.content();
      } else if (contentSource === 'scripts') {
        content = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
      } else if (contentSource === 'text') {
        content = await page.evaluate(() => document.body.innerText);
      } else {
        // 'all' - search in both HTML and scripts
        const html = await page.content();
        const scripts = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
        content = html + '\n' + scripts;
      }

      const regex = new RegExp(regexPattern, regexFlags);
      const matches = content.match(regex) || [];

      return {
        pattern: regexPattern,
        flags: regexFlags,
        matchCount: matches.length,
        matches: matches.slice(0, maxMatches)
      };
    };

    // Helper: Extract JSON data
    const extractJson = async (jsonSource, sel, path) => {
      const jsonData = [];

      if (jsonSource === 'ld+json') {
        const ldJson = await page.$$eval('script[type="application/ld+json"]', scripts =>
          scripts.map(s => {
            try { return JSON.parse(s.textContent); } catch { return null; }
          }).filter(Boolean)
        );
        jsonData.push(...ldJson);
      } else if (jsonSource === 'scripts') {
        const content = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
        // Look for JSON objects in scripts
        const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]/g;
        const matches = content.match(jsonRegex) || [];
        for (const match of matches.slice(0, maxJsonObjects)) {
          try {
            const parsed = JSON.parse(match);
            jsonData.push(parsed);
          } catch { }
        }
      } else if (jsonSource === 'api') {
        // Try to find API responses in page data
        const apiData = await page.evaluate(() => {
          const data = [];
          // Look for common API data storage patterns
          if (window.__DATA__) data.push(window.__DATA__);
          if (window.__INITIAL_STATE__) data.push(window.__INITIAL_STATE__);
          if (window.__APP_DATA__) data.push(window.__APP_DATA__);
          if (window.data) data.push(window.data);
          if (window.config) data.push(window.config);
          return data;
        });
        jsonData.push(...apiData);
      } else if (sel) {
        try {
          const text = await page.$eval(sel, el => el.textContent);
          const parsed = JSON.parse(text);
          jsonData.push(parsed);
        } catch { }
      } else {
        // 'page' - try all sources
        const ldJson = await page.$$eval('script[type="application/ld+json"]', scripts =>
          scripts.map(s => {
            try { return JSON.parse(s.textContent); } catch { return null; }
          }).filter(Boolean)
        );
        jsonData.push(...ldJson);
      }

      // Apply JSONPath if specified
      if (path && jsonData.length > 0) {
        // Simple JSONPath implementation
        const getPath = (obj, pathStr) => {
          const parts = pathStr.replace(/^\$\./, '').split('.');
          let current = obj;
          for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            if (part.includes('[') && part.includes(']')) {
              const arrName = part.substring(0, part.indexOf('['));
              const idx = parseInt(part.match(/\[(\d+)\]/)?.[1] || '0');
              current = current[arrName]?.[idx];
            } else {
              current = current[part];
            }
          }
          return current;
        };

        return jsonData.map(obj => ({
          original: obj,
          extracted: getPath(obj, path)
        }));
      }

      return jsonData;
    };

    // Helper: Extract meta tags
    const extractMeta = async (metaTypes) => {
      const meta = await page.evaluate((includeTitle, includeCanonical) => {
        const result = { meta: {}, og: {}, twitter: {} };

        document.querySelectorAll('meta').forEach(tag => {
          const name = tag.getAttribute('name') || tag.getAttribute('property');
          const content = tag.getAttribute('content');
          if (name && content) {
            if (name.startsWith('og:')) {
              result.og[name.replace('og:', '')] = content;
            } else if (name.startsWith('twitter:')) {
              result.twitter[name.replace('twitter:', '')] = content;
            } else {
              result.meta[name] = content;
            }
          }
        });

        if (includeTitle) {
          result.title = document.title;
        }
        if (includeCanonical) {
          result.canonical = document.querySelector('link[rel="canonical"]')?.href;
        }

        return result;
      }, includeTitle, includeCanonical);

      // Filter by requested types
      const filtered = {};
      if (metaTypes.includes('all')) {
        return meta;
      }
      if (metaTypes.includes('meta')) filtered.meta = meta.meta;
      if (metaTypes.includes('og')) filtered.og = meta.og;
      if (metaTypes.includes('twitter')) filtered.twitter = meta.twitter;
      if (includeTitle) filtered.title = meta.title;
      if (includeCanonical) filtered.canonical = meta.canonical;

      return filtered;
    };

    // Helper: Extract structured data from selector
    const extractStructured = async (sel, wait = false, timeout = 10000) => {
      if (wait) {
        await page.waitForSelector(sel, { timeout });
      }

      const element = await page.$(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }

      const data = await element.evaluate(el => ({
        tagName: el.tagName,
        text: el.innerText,
        html: el.innerHTML,
        attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])),
        childCount: el.children.length,
        boundingBox: el.getBoundingClientRect ? {
          x: el.getBoundingClientRect().x,
          y: el.getBoundingClientRect().y,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height
        } : null
      }));

      return data;
    };

    // Helper: Auto-detect and extract all
    const extractAuto = async () => {
      const autoResults = {
        meta: null,
        json: null,
        structured: null,
        patterns: []
      };

      // Extract meta tags
      try {
        autoResults.meta = await extractMeta(['all']);
      } catch (e) { }

      // Extract JSON-LD
      try {
        autoResults.json = await extractJson('ld+json');
      } catch (e) { }

      // Look for common data patterns
      const commonPatterns = [
        { name: 'emails', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' },
        { name: 'phones', pattern: '(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}' },
        { name: 'urls', pattern: 'https?://[^\s<>"{}|\\^`\[\]]+' },
        { name: 'ipv4', pattern: '\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b' }
      ];

      const pageText = await page.evaluate(() => document.body.innerText);
      for (const { name, pattern } of commonPatterns) {
        const regex = new RegExp(pattern, 'gi');
        const matches = [...new Set(pageText.match(regex) || [])];
        if (matches.length > 0) {
          autoResults.patterns.push({ type: name, count: matches.length, samples: matches.slice(0, 10) });
        }
      }

      return autoResults;
    };

    // Main switch based on type
    switch (type) {
      case 'regex': {
        if (!pattern) {
          return { success: false, error: 'Pattern is required for regex extraction' };
        }
        results.extracted = await extractRegex(pattern, flags, source);
        notifyProgress('extract_data', 'completed', `Regex: ${results.extracted.matchCount} matches`);
        break;
      }

      case 'json': {
        results.extracted = await extractJson(source, selector, jsonPath);
        results.count = Array.isArray(results.extracted) ? results.extracted.length : 0;
        notifyProgress('extract_data', 'completed', `JSON: ${results.count} objects`);
        break;
      }

      case 'meta': {
        results.extracted = await extractMeta(types);
        const tagCount = Object.values(results.extracted).reduce((sum, val) => {
          if (typeof val === 'object' && val !== null) {
            return sum + Object.keys(val).length;
          }
          return sum + (val ? 1 : 0);
        }, 0);
        notifyProgress('extract_data', 'completed', `Meta: ${tagCount} tags`);
        break;
      }

      case 'structured': {
        if (!selector) {
          return { success: false, error: 'Selector is required for structured extraction' };
        }
        results.extracted = await extractStructured(selector, waitForSelector, selectorTimeout);
        if (results.extracted.error) {
          results.success = false;
          results.error = results.extracted.error;
          delete results.extracted;
        }
        notifyProgress('extract_data', 'completed', results.success ? 'Structured data extracted' : 'Extraction failed');
        break;
      }

      case 'auto': {
        results.extracted = await extractAuto();
        const summary = [];
        if (results.extracted.meta) summary.push('meta');
        if (results.extracted.json?.length) summary.push('json');
        if (results.extracted.patterns?.length) summary.push('patterns');
        notifyProgress('extract_data', 'completed', `Auto: ${summary.join(', ')}`);
        break;
      }

      case 'deobfuscate': {
        notifyProgress('extract_data', 'in_progress', 'Deobfuscating JavaScript (enhanced)...');
        const scriptContents = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
        }).catch(() => '');
        const externalScripts = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
        }).catch(() => []);

        let allJs = scriptContents;
        for (const src of externalScripts.slice(0, 10)) {
          try { const resp = await fetch(src); allJs += '\n' + await resp.text(); } catch (e) { }
        }

        const deobfuscated = {
          stringArrays: [], decodedStrings: [], functionMappings: [],
          apiEndpoints: [], urls: [], fetchCalls: [],
          webpackModules: [], evalUnpacked: [], resolvedConcats: [], unicodeDecoded: []
        };

        // 1. Original _0x style string arrays
        const arrayPattern = /(?:const|var|let)\s+(_0x[a-f0-9]+)\s*=\s*\[([^\]]{20,})\]/g;
        let match;
        while ((match = arrayPattern.exec(allJs)) !== null) {
          const varName = match[1];
          try {
            const items = match[2].match(/'([^']*)'|"([^"]*)"/g) || [];
            const decoded = items.map(s => s.replace(/^['"]|['"]$/g, ''));
            deobfuscated.stringArrays.push({ variable: varName, count: decoded.length, strings: decoded });
            deobfuscated.decodedStrings.push(...decoded);
          } catch (e) { }
        }

        // 2. Hex-encoded strings
        const hexStrings = [...new Set((allJs.match(/(?:'(?:\\x[0-9a-f]{2})+[^']*'|"(?:\\x[0-9a-f]{2})+[^"]*")/gi) || []))];
        for (const hs of hexStrings.slice(0, 50)) {
          try {
            const decoded = hs.slice(1, -1).replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
            if (decoded.length > 2) deobfuscated.decodedStrings.push(decoded);
          } catch (e) { }
        }

        // 3. NEW: Unicode escape sequences (\u0066\u0065\u0074\u0063\u0068 → fetch)
        const unicodePattern = /(?:'(?:\\u[0-9a-f]{4})+[^']*'|"(?:\\u[0-9a-f]{4})+[^"]*")/gi;
        const unicodeMatches = allJs.match(unicodePattern) || [];
        for (const um of unicodeMatches.slice(0, 50)) {
          try {
            const decoded = um.slice(1, -1).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
            if (decoded.length > 1) { deobfuscated.unicodeDecoded.push(decoded); deobfuscated.decodedStrings.push(decoded); }
          } catch (e) { }
        }

        // 4. NEW: Eval unpacker — eval(function(p,a,c,k,e,d){...})
        const evalPattern = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,?\s*[dr]?\s*\)\s*\{[^}]*\}\s*\(\s*'([^']*)'(?:\s*,\s*(\d+)){2}\s*,\s*'([^']*)'/g;
        let evalMatch;
        while ((evalMatch = evalPattern.exec(allJs)) !== null) {
          try {
            const p = evalMatch[1], a = parseInt(evalMatch[2]) || 62;
            const keywords = evalMatch[3].split('|');
            const unpacked = p.replace(/\b\w+\b/g, w => {
              const n = parseInt(w, a);
              return (n < keywords.length && keywords[n]) ? keywords[n] : w;
            });
            deobfuscated.evalUnpacked.push(unpacked.substring(0, 3000));
            // Extract strings from unpacked code
            const unpackedStrings = unpacked.match(/['"]([^'"]{3,})['"]/g) || [];
            for (const s of unpackedStrings.slice(0, 100)) {
              deobfuscated.decodedStrings.push(s.replace(/^['"]|['"]$/g, ''));
            }
          } catch (e) { }
        }
        // Also handle simpler eval patterns
        const simpleEval = /eval\s*\(\s*['"]([^'"]{10,})['"]\s*\)/g;
        let seMatch;
        while ((seMatch = simpleEval.exec(allJs)) !== null) {
          deobfuscated.evalUnpacked.push(seMatch[1].substring(0, 2000));
        }

        // 5. NEW: Webpack module detection
        const webpackPatterns = [
          /(?:__webpack_require__|__webpack_modules__)\s*\[\s*['"]?(\w+)['"]?\s*\]/g,
          /(?:const|var|let)\s+\w+\s*=\s*\{[\s\S]{0,50}__webpack_require__/g,
          /\(\s*function\s*\(\s*modules\s*\)\s*\{[\s\S]{0,200}__webpack_require__/g
        ];
        const webpackExports = allJs.match(/(?:module\.exports|exports\.\w+)\s*=\s*['"]([^'"]+)['"]/g) || [];
        for (const exp of webpackExports.slice(0, 30)) {
          const val = exp.match(/=\s*['"]([^'"]+)['"]/);
          if (val) { deobfuscated.webpackModules.push(val[1]); deobfuscated.decodedStrings.push(val[1]); }
        }
        // Detect webpack chunk loading and module IDs
        const chunkIds = allJs.match(/webpackChunk\w*\.push\s*\(\s*\[\s*\[([^\]]+)\]/g) || [];
        for (const ci of chunkIds.slice(0, 10)) {
          deobfuscated.webpackModules.push(`chunk: ${ci.substring(0, 100)}`);
        }

        // 6. NEW: Terser/UglifyJS single-letter variable mappings
        const terserPattern = /(?:var|let|const)\s+([a-z])\s*=\s*['"]([^'"]{2,})['"]/gi;
        let terserMatch;
        const terserMappings = {};
        while ((terserMatch = terserPattern.exec(allJs)) !== null) {
          const varName = terserMatch[1], value = terserMatch[2];
          if (value.length > 2 && value.length < 200) {
            terserMappings[varName] = value;
            deobfuscated.functionMappings.push({ variable: varName, value: value });
            deobfuscated.decodedStrings.push(value);
          }
        }

        // 7. NEW: String concatenation resolution ("htt"+"ps://" → "https://")
        const concatPattern = /(?:['"][^'"]*['"]\s*\+\s*){2,}['"][^'"]*['"]/g;
        const concatMatches = allJs.match(concatPattern) || [];
        for (const cm of concatMatches.slice(0, 50)) {
          try {
            const parts = cm.match(/['"]([^'"]*)['"]|(['"])/g) || [];
            const resolved = parts.map(p => p.replace(/^['"]|['"]$/g, '')).join('');
            if (resolved.length > 3) { deobfuscated.resolvedConcats.push(resolved); deobfuscated.decodedStrings.push(resolved); }
          } catch (e) { }
        }

        // 8. NEW: Array rotation detection — function with push/shift on array
        const rotationPattern = /function\s+\w*\s*\(\s*(_0x[a-f0-9]+)\s*,\s*\w+\s*\)\s*\{[\s\S]{0,500}push\s*\(\s*\1\s*\.\s*shift\s*\(\s*\)\s*\)/g;
        const rotations = allJs.match(rotationPattern) || [];
        if (rotations.length > 0) {
          deobfuscated.functionMappings.push({ type: 'array_rotation', count: rotations.length, note: 'Array rotation functions detected — strings may be shifted' });
        }

        // Extract URLs and API endpoints from all decoded strings
        deobfuscated.urls = [...new Set(deobfuscated.decodedStrings.filter(s =>
          s.match(/^(https?:\/\/|\/)/) || s.match(/\.(php|json|api|asp|jsp)$/i)
        ))].slice(0, 50);
        deobfuscated.apiEndpoints = [...new Set(deobfuscated.decodedStrings.filter(s =>
          s.match(/^\/[a-z]/i) && s.length > 3 && s.length < 100
        ))].slice(0, 30);

        // Find fetch patterns
        const fetchPatterns = allJs.match(/fetch\s*\(\s*['"]([^'"]+)['"]/g) || [];
        deobfuscated.fetchCalls = fetchPatterns.map(f => f.replace(/fetch\s*\(\s*['"]/, '').replace(/['"]$/, '')).slice(0, 20);
        deobfuscated.decodedStrings = [...new Set(deobfuscated.decodedStrings)].slice(0, 500);

        results.extracted = deobfuscated;
        const summary = `${deobfuscated.stringArrays.length} arrays, ${deobfuscated.decodedStrings.length} strings, ${deobfuscated.evalUnpacked.length} eval unpacked, ${deobfuscated.webpackModules.length} webpack modules, ${deobfuscated.resolvedConcats.length} concats resolved, ${deobfuscated.unicodeDecoded.length} unicode decoded`;
        notifyProgress('extract_data', 'completed', `Deobfuscated(enhanced): ${summary}`);
        break;
      }

      case 'apiDiscovery': {
        notifyProgress('extract_data', 'in_progress', 'Discovering hidden API endpoints...');
        const apiResults = {
          fetchEndpoints: [], xhrEndpoints: [], formActions: [],
          scriptSources: [], inlineApiPatterns: [], postBodies: [], dynamicApis: []
        };

        // 1. Intercept runtime fetch/XHR
        try {
          const runtimeApis = await page.evaluate(() => {
            return new Promise((resolve) => {
              const found = [];
              if (window.__capturedApis) { resolve(window.__capturedApis); return; }
              const origFetch = window.fetch;
              window.fetch = function (...args) {
                try {
                  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                  const opts = args[1] || {};
                  found.push({
                    type: 'fetch', url, method: opts.method || 'GET',
                    body: typeof opts.body === 'string' ? opts.body.substring(0, 500) : null
                  });
                } catch (e) { }
                return origFetch.apply(this, args);
              };
              const origOpen = XMLHttpRequest.prototype.open;
              const origSend = XMLHttpRequest.prototype.send;
              XMLHttpRequest.prototype.open = function (method, url) { this.__apiUrl = url; this.__apiMethod = method; return origOpen.apply(this, arguments); };
              XMLHttpRequest.prototype.send = function (body) {
                found.push({
                  type: 'xhr', url: this.__apiUrl, method: this.__apiMethod,
                  body: typeof body === 'string' ? body.substring(0, 500) : null
                });
                return origSend.apply(this, arguments);
              };
              window.__capturedApis = found;
              setTimeout(() => resolve(found), 3000);
            });
          });
          apiResults.dynamicApis = runtimeApis;
        } catch (e) { apiResults.dynamicApis = []; }

        // 2. Static analysis
        const allScriptContent = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
        }).catch(() => '');

        const fetchRegex = /fetch\s*\(\s*(?:['"`]([^'"`]+)['"`]|([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
        let fMatch;
        while ((fMatch = fetchRegex.exec(allScriptContent)) !== null) {
          apiResults.fetchEndpoints.push(fMatch[1] || fMatch[2]);
        }
        apiResults.fetchEndpoints = [...new Set(apiResults.fetchEndpoints)].slice(0, 30);

        const xhrRegex = /\.open\s*\(\s*['"](?:GET|POST|PUT|DELETE)['"]\s*,\s*['"`]([^'"`]+)['"`]/gi;
        let xMatch;
        while ((xMatch = xhrRegex.exec(allScriptContent)) !== null) {
          apiResults.xhrEndpoints.push(xMatch[1]);
        }
        apiResults.xhrEndpoints = [...new Set(apiResults.xhrEndpoints)].slice(0, 30);

        apiResults.formActions = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('form[action]')).map(f => ({ action: f.action, method: f.method || 'GET', id: f.id || null }));
        }).catch(() => []);

        const postBodyPatterns = allScriptContent.match(/(?:URLSearchParams|FormData|JSON\.stringify)\s*\(\s*\{[^}]{5,200}\}/g) || [];
        apiResults.postBodies = postBodyPatterns.slice(0, 10);

        const apiUrlPattern = /['"`]((?:https?:\/\/[^'"`]+|\/)(?:[a-zA-Z0-9_\-\/]+\.(?:php|json|api|asp|aspx|do|action))[^'"`]*)['"`]/g;
        let apiMatch;
        while ((apiMatch = apiUrlPattern.exec(allScriptContent)) !== null) {
          apiResults.inlineApiPatterns.push(apiMatch[1]);
        }
        apiResults.inlineApiPatterns = [...new Set(apiResults.inlineApiPatterns)].slice(0, 30);

        apiResults.scriptSources = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
        }).catch(() => []);

        results.extracted = apiResults;
        const totalFound = apiResults.fetchEndpoints.length + apiResults.xhrEndpoints.length +
          apiResults.inlineApiPatterns.length + apiResults.dynamicApis.length;
        notifyProgress('extract_data', 'completed', `API Discovery: ${totalFound} endpoints found`);
        break;
      }

      // ====== FEATURE 4: Response Auto-Decryption ======
      case 'decrypt': {
        notifyProgress('extract_data', 'in_progress', 'Auto-decrypting data...');
        const { encryptedData, autoFindKey = true } = params;
        const decryptResults = {
          original: null, decoded: [], detectedEncoding: [], extractedKeys: [], aesDecrypted: null
        };

        // Get data to decrypt — from param or from page
        let dataToDecrypt = encryptedData;
        if (!dataToDecrypt) {
          // Try to get from clipboard or last API response
          const lastApiResponse = networkRecords.filter(r => r.responseBody).pop();
          if (lastApiResponse) dataToDecrypt = lastApiResponse.responseBody;
        }
        if (!dataToDecrypt) {
          return { success: false, error: 'No data to decrypt. Provide encryptedData parameter or start network_recorder first.' };
        }
        decryptResults.original = dataToDecrypt.substring(0, 500);

        // 1. Base64 chain decode (recursive, up to 5 levels)
        let b64Data = dataToDecrypt.trim();
        for (let level = 0; level < 5; level++) {
          if (!/^[A-Za-z0-9+/=]+$/.test(b64Data) || b64Data.length < 4) break;
          try {
            const decoded = Buffer.from(b64Data, 'base64').toString('utf-8');
            if (decoded && decoded.length > 0 && !/[\x00-\x08\x0e-\x1f]/.test(decoded.substring(0, 100))) {
              decryptResults.decoded.push({ level: level + 1, type: 'base64', value: decoded.substring(0, 5000) });
              decryptResults.detectedEncoding.push('base64');
              // Check if result is JSON
              try {
                const json = JSON.parse(decoded);
                decryptResults.decoded.push({ level: level + 1, type: 'base64_json', value: json });
              } catch (e) { }
              b64Data = decoded; // Continue chain
            } else break;
          } catch (e) { break; }
        }

        // 2. Hex decode
        const hexClean = dataToDecrypt.replace(/\s+/g, '');
        if (/^[0-9a-f]+$/i.test(hexClean) && hexClean.length >= 6 && hexClean.length % 2 === 0) {
          try {
            const hexDecoded = Buffer.from(hexClean, 'hex').toString('utf-8');
            if (hexDecoded && !/[\x00-\x08\x0e-\x1f]/.test(hexDecoded.substring(0, 50))) {
              decryptResults.decoded.push({ type: 'hex', value: hexDecoded.substring(0, 5000) });
              decryptResults.detectedEncoding.push('hex');
            }
          } catch (e) { }
        }

        // 3. URL decode (multi-level)
        if (dataToDecrypt.includes('%')) {
          try {
            let urlDecoded = decodeURIComponent(dataToDecrypt);
            decryptResults.decoded.push({ type: 'url', value: urlDecoded.substring(0, 5000) });
            decryptResults.detectedEncoding.push('url');
            // Double URL decode
            if (urlDecoded.includes('%')) {
              urlDecoded = decodeURIComponent(urlDecoded);
              decryptResults.decoded.push({ type: 'url_double', value: urlDecoded.substring(0, 5000) });
            }
          } catch (e) { }
        }

        // 4. ROT13
        try {
          const rot13 = dataToDecrypt.replace(/[a-zA-Z]/g, c => {
            const base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
          });
          if (rot13 !== dataToDecrypt && (rot13.includes('http') || rot13.includes('www') || rot13.includes('.com'))) {
            decryptResults.decoded.push({ type: 'rot13', value: rot13.substring(0, 5000) });
            decryptResults.detectedEncoding.push('rot13');
          }
        } catch (e) { }

        // 5. Auto-extract encryption keys from page scripts
        if (autoFindKey) {
          try {
            const keys = await page.evaluate(() => {
              const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
              const found = [];
              // CryptoJS patterns
              const cryptoPatterns = [
                /CryptoJS\.AES\.decrypt\s*\(\s*\w+\s*,\s*['"]([^'"]+)['"]/g,
                /CryptoJS\.AES\.encrypt\s*\(\s*\w+\s*,\s*['"]([^'"]+)['"]/g,
                /CryptoJS\.enc\.Utf8\.parse\s*\(\s*['"]([^'"]+)['"]/g,
                /(?:secret|key|pass|password|iv|salt)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
                /aes(?:Key|_key|Secret)\s*[:=]\s*['"]([^'"]{8,})['"]/gi
              ];
              for (const pat of cryptoPatterns) {
                let m;
                while ((m = pat.exec(scripts)) !== null) {
                  found.push({ pattern: pat.source.substring(0, 50), key: m[1] });
                }
              }
              return found;
            });
            decryptResults.extractedKeys = keys.slice(0, 20);
          } catch (e) { }
        }

        // 6. AES decryption — try with extracted keys or user-provided key
        const aesKey = params.aesKey || (decryptResults.extractedKeys[0]?.key);
        if (aesKey && dataToDecrypt.length > 10) {
          try {
            const crypto = require('crypto');
            // Try AES-256-CBC
            for (const keyEncoding of ['utf8', 'hex', 'base64']) {
              try {
                let keyBuf;
                if (keyEncoding === 'utf8') keyBuf = Buffer.alloc(32); // pad to 32 bytes
                else keyBuf = Buffer.from(aesKey, keyEncoding);
                if (keyEncoding === 'utf8') { const kb = Buffer.from(aesKey, 'utf8'); kb.copy(keyBuf); }

                // Try to decode the data from base64 first
                const dataBuf = Buffer.from(dataToDecrypt, 'base64');
                if (dataBuf.length > 16) {
                  // IV might be first 16 bytes
                  const iv = params.aesIV ? Buffer.from(params.aesIV, keyEncoding) : dataBuf.slice(0, 16);
                  const encrypted = params.aesIV ? dataBuf : dataBuf.slice(16);
                  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
                  decipher.setAutoPadding(true);
                  let decrypted = decipher.update(encrypted, undefined, 'utf8');
                  decrypted += decipher.final('utf8');
                  if (decrypted && decrypted.length > 0) {
                    decryptResults.aesDecrypted = decrypted.substring(0, 5000);
                    decryptResults.detectedEncoding.push('aes-256-cbc');
                    // Try JSON parse
                    try { decryptResults.aesDecrypted = JSON.parse(decrypted); } catch (e) { }
                    break;
                  }
                }
              } catch (e) { continue; }
            }
          } catch (e) { }
        }

        results.extracted = decryptResults;
        const decodedCount = decryptResults.decoded.length + (decryptResults.aesDecrypted ? 1 : 0);
        notifyProgress('extract_data', 'completed', `Decrypted: ${decodedCount} decodings, ${decryptResults.extractedKeys.length} keys found, encodings: ${decryptResults.detectedEncoding.join(', ') || 'none'}`);
        break;
      }

      default:
        return { success: false, error: `Unknown type: ${type}. Supported: regex, json, meta, structured, auto, deobfuscate, apiDiscovery, decrypt` };
    }

    return results;
  },

  // 🤖 Universal Smart Form Automator
  async form_automator(params) {
    const { page } = requireBrowser();
    const { data = {}, submit = false, aiMatch = true, captcha = true } = params;

    notifyProgress('form_automator', 'started', '🤖 Starting Universal Form Automation...');

    // 1. Analyze Page Structure
    notifyProgress('form_automator', 'progress', '🔍 Analyzing page structure...');
    const analysis = await ocr.analyzePageForForms(page);

    notifyProgress('form_automator', 'progress', `Found: ${analysis.inputs.length} inputs, ${analysis.dropdowns.length} selects, ${analysis.captchas.length} captchas`);

    // 2. Map and Fill Data
    const filledFields = [];

    // Convert data keys to lowercase for matching
    const normalizedData = {};
    for (const [k, v] of Object.entries(data)) {
      normalizedData[k.toLowerCase()] = v;
    }

    // Combine all fillable fields
    const allFields = [...analysis.inputs, ...analysis.dropdowns];

    for (const field of allFields) {
      let bestMatchKey = null;
      let matchScore = 0;

      // Try to find matching data key
      for (const [dataKey, value] of Object.entries(data)) {
        let score = 0;
        const lowerKey = dataKey.toLowerCase();
        const lowerId = (field.id || '').toLowerCase();
        const lowerName = (field.name || '').toLowerCase();
        const lowerPlaceholder = (field.placeholder || '').toLowerCase();

        // Heuristic Scoring
        if (lowerId === lowerKey) score += 10;
        else if (lowerId.includes(lowerKey)) score += 5;

        if (lowerName === lowerKey) score += 10;
        else if (lowerName.includes(lowerKey)) score += 5;

        if (lowerPlaceholder.includes(lowerKey)) score += 3;

        // Type verification (don't fill 'year' into 'name')
        // ... (simple version for now)

        if (score > matchScore) {
          matchScore = score;
          bestMatchKey = dataKey;
        }
      }

      if (bestMatchKey && matchScore > 0) {
        const value = data[bestMatchKey];
        const identity = field.id ? `#${field.id}` : `[name="${field.name}"]`;

        notifyProgress('form_automator', 'progress', `Filling '${bestMatchKey}' into ${identity}`);

        try {
          if (field.tagName === 'SELECT') {
            // Smart Select
            await page.evaluate((sel, val) => {
              const el = document.querySelector(sel);
              if (!el) return;

              // Try exact value match
              el.value = val;
              if (el.value === val) { // Success
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return;
              }

              // Try text match (fuzzy)
              for (const opt of el.options) {
                if (opt.text.toLowerCase().includes(val.toLowerCase())) {
                  el.value = opt.value;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  break;
                }
              }
            }, identity, String(value));
          } else {
            // Smart Type
            const { createCursor } = require('ghost-cursor-patchright');
            const cursor = createCursor(page);

            // Click center of element
            await cursor.click(identity);

            // Clear existing
            await page.evaluate(s => document.querySelector(s).value = '', identity);

            // Human-like typing
            await page.type(identity, String(value), { delay: Math.floor(Math.random() * 50) + 30 });

            // Random small pause
            await new Promise(r => setTimeout(r, Math.random() * 500));
          }
          filledFields.push(bestMatchKey);
        } catch (e) {
          notifyProgress('form_automator', 'warn', `Failed to fill ${bestMatchKey}: ${e.message}`);
        }
      }
    }

    // 3. Solve Captcha
    if (captcha && analysis.captchas.length > 0) {
      notifyProgress('form_automator', 'progress', '🧩 Processing Captcha...');
      const visibleCaptcha = analysis.captchas.find(c => c.visible);

      if (visibleCaptcha) {
        // Check if we have an input for the captcha
        const captchaInput = analysis.inputs.find(i =>
          i.id?.includes('captcha') ||
          i.name?.includes('captcha') ||
          (i.placeholder && i.placeholder.toLowerCase().includes('captcha'))
        );

        await ocr.solveCaptchaWithVerification(page, {
          captchaSelector: visibleCaptcha.selector || '#captcha_image',
          inputSelector: captchaInput ? (captchaInput.id ? `#${captchaInput.id}` : `[name="${captchaInput.name}"]`) : '#fcaptcha_code',
          aiMode: true,
          autoRetry: true,
          verifyBeforeSubmit: submit // Verify if submitting
        });
      }
    }

    // 4. Submit
    if (submit) {
      notifyProgress('form_automator', 'progress', '🚀 Submitting form...');

      // Find clickables with 'submit', 'search', 'go' text
      const submitSelector = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'));
        const candidates = buttons.filter(b => {
          const text = (b.innerText || b.value || '').toLowerCase();
          return text.includes('submit') || text.includes('go') || text.includes('search') || text.includes('view') || text.includes('login');
        });

        // Sort by likelihood/visibility
        const best = candidates.find(b => b.offsetParent !== null); // First visible one

        if (best) {
          return best.id ? `#${best.id}` : (best.className ? `.${best.className.split(' ')[0]}` : 'button[type="submit"]');
        }
        return null;
      });

      if (submitSelector) {
        const { createCursor } = require('ghost-cursor-patchright');
        const cursor = createCursor(page);
        await cursor.click(submitSelector);

        try {
          await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' });
          notifyProgress('form_automator', 'completed', 'Form submitted and navigation complete');
        } catch (e) {
          notifyProgress('form_automator', 'completed', 'Form submitted (no navigation detected)');
        }
      } else {
        notifyProgress('form_automator', 'warn', 'Could not auto-detect submit button');
      }
    }

    return {
      success: true,
      filledFields,
      message: `Form filled: ${filledFields.join(', ')}`
    };
  }
};

// ═══════════════════════════════════════════════════════════════
// 🤖 AI-POWERED CORE INTEGRATION
// All tools automatically get AI features (auto-healing, smart find)
// ═══════════════════════════════════════════════════════════════

let aiCore = null;

/**
 * Get or initialize AI Core (lazy loading)
 */
function getAICore() {
  if (!aiCore) {
    try {
      const ai = require('../ai');
      aiCore = ai.aiCore;
      aiCore.configure({ logLevel: 'info', enableAutoHeal: true });
      console.error('🤖 [AI] AI Core initialized - all tools now AI-enhanced');
    } catch (e) {
      console.error('⚠️ [AI] AI Core not available:', e.message);
      return null;
    }
  }
  return aiCore;
}

/**
 * AI-Enhanced selector operation
 * Automatically heals broken selectors
 */
async function aiEnhancedSelector(page, selector, operation, options = {}) {
  const ai = getAICore();

  // Try original selector first
  try {
    const element = await page.$(selector);
    if (element) {
      return { element, selector, healed: false };
    }
  } catch (e) {
    // Selector failed
  }

  // If AI available, try to heal
  if (ai && ai.config.enableAutoHeal) {
    console.error(`🩹 [AI] Selector "${selector}" not found, attempting heal...`);

    try {
      const alternatives = await ai.selectorHealer.heal(page, selector, {
        maxAlternatives: 3
      });

      for (const alt of alternatives) {
        try {
          const element = await page.$(alt.selector);
          if (element) {
            console.error(`✅ [AI] Healed: "${selector}" → "${alt.selector}" (${Math.round(alt.confidence * 100)}% confidence)`);
            return { element, selector: alt.selector, healed: true, originalSelector: selector };
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      console.error(`⚠️ [AI] Heal failed:`, e.message);
    }
  }

  return { element: null, selector, healed: false };
}

/**
 * Execute a tool by name - NOW WITH AI INTEGRATION
 * 
 * AI Features automatically applied:
 * - Auto-healing: If selector fails, AI tries to find alternatives
 * - Smart retry: Failed operations are retried with AI assistance
 * - All 28 tools benefit from AI without any changes
 */
async function executeTool(name, params = {}) {
  const handler = handlers[name];

  if (!handler) {
    notifyProgress(name, 'error', `Unknown tool: ${name}`);
    return { success: false, error: `Unknown tool: ${name}` };
  }

  // Initialize AI Core (lazy)
  getAICore();

  const startTime = Date.now();

  try {
    // Execute the handler
    const result = await handler(params);

    // If successful, return with AI metadata
    if (result.success) {
      return {
        ...result,
        _ai: {
          enabled: !!aiCore,
          healed: false,
          duration: Date.now() - startTime
        }
      };
    }

    // If failed with "not found" error and has selector, try AI healing
    if (result.error?.includes('not found') && params.selector && aiCore) {
      notifyProgress(name, 'progress', '🤖 AI attempting recovery...');

      const { page } = getState();
      if (page) {
        const healed = await aiEnhancedSelector(page, params.selector, name);

        if (healed.element) {
          // Retry with healed selector
          const retryParams = { ...params, selector: healed.selector };
          const retryResult = await handler(retryParams);

          return {
            ...retryResult,
            _ai: {
              enabled: true,
              healed: true,
              originalSelector: params.selector,
              healedSelector: healed.selector,
              duration: Date.now() - startTime
            }
          };
        }
      }
    }

    return {
      ...result,
      _ai: { enabled: !!aiCore, healed: false, duration: Date.now() - startTime }
    };

  } catch (error) {
    notifyProgress(name, 'error', error.message);

    // Try AI recovery for selector-based errors
    if (error.message?.includes('selector') && params.selector && aiCore) {
      notifyProgress(name, 'progress', '🤖 AI attempting error recovery...');

      try {
        const { page } = getState();
        if (page) {
          const healed = await aiEnhancedSelector(page, params.selector, name);

          if (healed.element) {
            const retryParams = { ...params, selector: healed.selector };
            const retryResult = await handler(retryParams);

            return {
              ...retryResult,
              _ai: {
                enabled: true,
                healed: true,
                recoveredFromError: true,
                originalSelector: params.selector,
                healedSelector: healed.selector,
                duration: Date.now() - startTime
              }
            };
          }
        }
      } catch (retryError) {
        // Recovery failed
      }
    }

    return {
      success: false,
      error: error.message,
      _ai: { enabled: !!aiCore, healed: false, duration: Date.now() - startTime }
    };
  }
}

/**
 * Cleanup - close browser if open
 */
async function cleanup() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (e) {
      browserInstance.process()?.kill('SIGKILL');
    }
    browserInstance = null;
    pageInstance = null;
    blockerInstance = null;
    setupPageFn = null;
  }
}

module.exports = {
  handlers,
  executeTool,
  cleanup,
  getState,
  requireBrowser,
  setProgressCallback,
  notifyProgress,
  getHeadlessFromEnv,
  // AI Core exports
  getAICore,
  aiEnhancedSelector
};

// Auto-generated helpers handlers
import { requireBrowser, notifyProgress } from './state';

export const helpersHandlers = {
  async _resolveIframeContext(page: any, iframe: any, iframeSelector: any) {
    let targetFrame: any = page;
    let frameInfo: any = null;

    if (iframe !== null && iframe !== undefined) {
      const frames = page.frames();
      if (iframe === 0) {
        targetFrame = page.mainFrame() as any;
        frameInfo = { index: 0, url: page.url(), isMain: true };
      } else if (frames[iframe]) {
        targetFrame = frames[iframe] as any;
        frameInfo = { index: iframe, url: frames[iframe].url() };
      } else {
        return { success: false, error: `Iframe index ${iframe} not found. Available: 0-${frames.length - 1}` };
      }
    } else if (iframeSelector) {
      const iframeHandle = await page.$(iframeSelector);
      if (iframeHandle) {
        const frame = await iframeHandle.contentFrame();
        if (frame) {
          targetFrame = frame as any;
          frameInfo = { selector: iframeSelector, url: frame.url() };
        } else {
          return { success: false, error: `Iframe selector ${iframeSelector} not found` };
        }
      } else {
        return { success: false, error: `Iframe selector not found: ${iframeSelector}` };
      }
    }

    return { success: true, targetFrame, frameInfo };
  },

  async _handleBlockingModals(page: any) {
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

  async _analyzeFullPage(page: any) {
    return await page.evaluate(() => {
      const inputs: any[] = [];
      const allInputs = document.querySelectorAll('input, textarea, select');

      allInputs.forEach((el: any, index: any) => {
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

        // CSS.escape keeps generated selectors valid even when ids/names
        // contain quotes, brackets, or other selector-significant characters.
        const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s.replace(/(["\\])/g, '\\$1');

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
          selector: el.id ? `#${esc(el.id)}` : (el.name ? `[name="${esc(el.name)}"]` : `input[type="${esc(el.type)}"]:nth-of-type(${index + 1})`)
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

  async _fillFormFields(page: any, formData: any, formSelector: any, humanLike = true, aiMatch = true) {
    const targetForm = formSelector || 'form';
    const fields = Object.keys(formData || {});
    let filledCount = 0;
    const filledFields = [];
    const unfilledFields = [];

    // First, analyze the full page
    const pageInfo = await helpersHandlers._analyzeFullPage(page);
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
          await page.evaluate(({ sel, val }: any) => {
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
          }, { sel: bestMatch.selector, val: String(value) });
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


        filledCount++;
        filledFields.push({ field, selector: bestMatch.selector, matchScore: bestScore });
        notifyProgress('solve_captcha', 'progress', `📝 Filled: ${field} (score: ${bestScore})`, { field, filledCount });

        // ponytail: skip Tab on last field — avoids accidental form submit
        const isLastField = filledCount >= fields.length;
        if (humanLike && !isLastField) {
          await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
          await page.keyboard.press('Tab');
          await new Promise(r => setTimeout(r, 50));
        }
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

  async _validateBeforeSubmit(page: any) {
    return await page.evaluate(() => {
      const errors: any[] = [];
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

  async _detectPostSubmitErrors(page: any) {
    await new Promise(r => setTimeout(r, 1500)); // Wait for page response

    return await page.evaluate(() => {
      const errors: any[] = [];

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
        errors.push('Verification input is still empty - may require a retry');
      }

      return {
        hasErrors: errors.length > 0,
        errors: [...new Set(errors)].slice(0, 5) // Unique errors, max 5
      };
    });
  },


  async _submitForm(page: any, validateFirst = true, maxRetries = 1) {
    try {
      // Pre-submit validation
      if (validateFirst) {
        const validation = await helpersHandlers._validateBeforeSubmit(page);
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
        const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s.replace(/(["\\])/g, '\\$1');
        const best = candidates.find(b => b.offsetParent !== null);
        if (best) {
          return best.id ? `#${esc(best.id)}` : (best.name ? `[name="${esc(best.name)}"]` : 'button[type="submit"]');
        }
        // Fallback to any submit button
        const fallback = document.querySelector('button[type="submit"], input[type="submit"]');
        return fallback ? (fallback.id ? `#${esc(fallback.id)}` : 'button[type="submit"]') : null;
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
      } catch (e: any) {
        // No navigation - check for errors on same page
        const postErrors = await helpersHandlers._detectPostSubmitErrors(page);

        if (postErrors.hasErrors) {
          notifyProgress('solve_captcha', 'warn', `⚠️ Submit detected errors: ${postErrors.errors[0]}`);
          return {
            success: false,
            message: 'Form submitted but errors detected',
            errors: postErrors.errors,
            needsRetry: postErrors.errors.some((e: any) => e.toLowerCase().includes('captcha'))
          };
        }

        notifyProgress('solve_captcha', 'completed', '✅ Form submitted (no navigation detected)');
        return { success: true, message: 'Form submitted (no navigation detected)', navigated: false };
      }
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
};

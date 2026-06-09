// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil } from './state';
import { handlers } from './index';

// Auto-generated vision handlers

export const visionHandlers = {
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
              captchaImageBase64 = (await captchaEl.screenshot()).toString('base64');
            }
          } catch(e) {}

          // Take full context screenshot for host LLM fallback
          const screenshotBase64 = (await targetHandle.screenshot()).toString('base64');

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

  async see_page(params = {}) {
    const { page } = requireBrowser();
    const {
      fullPage = false,
      format = 'jpeg',
      quality = 70,
      includeElements = true,
      includeDomText = false,
      maxElements = 60,
      path: savePath
    } = params;

    notifyProgress('see_page', 'started', `👁️ Looking at the page (${fullPage ? 'full page' : 'viewport'})...`);

    // 1. Capture what the page looks like (the "eyes")
    const shotOpts = { type: format, fullPage };
    if (format === 'jpeg' && typeof quality === 'number') shotOpts.quality = quality;

    let buffer;
    try {
      buffer = await page.screenshot(shotOpts);
    } catch (e) {
      return { success: false, error: `Vision capture failed: ${e.message}` };
    }

    // 2. Build a "visual map" of visible interactive elements (what a human can act on)
    let elements = [];
    let pageInfo: any = {};
    if (includeElements) {
      const data = await page.evaluate(({ maxEls, isFullPage }) => {
        const out = [];
        const seen = new Set();
        const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]';
        const nodes = document.querySelectorAll(sel);

        const cssPath = (el) => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
          const parts = [];
          let node = el;
          while (node && node.nodeType === 1 && parts.length < 4) {
            let part = node.tagName.toLowerCase();
            if (node.classList.length) {
              const cls = Array.from(node.classList).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
              part += cls;
            }
            const parent = node.parentElement;
            if (parent) {
              const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
              if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
            }
            parts.unshift(part);
            node = node.parentElement;
          }
          return parts.join(' > ');
        };

        for (const el of nodes) {
          if (out.length >= maxEls) break;
          const rect = el.getBoundingClientRect();
          // Only elements actually visible on screen
          if (rect.width < 2 || rect.height < 2) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          if (!isFullPage) {
            if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
              // outside current viewport — skip (we report what is seen)
              continue;
            }
          }

          const tag = el.tagName.toLowerCase();
          let label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
          let kind = tag;
          if (tag === 'a') kind = 'link';
          else if (tag === 'button' || el.getAttribute('role') === 'button') kind = 'button';
          else if (tag === 'input') kind = `input:${el.type || 'text'}`;
          else if (tag === 'select') kind = 'select';
          else if (tag === 'textarea') kind = 'textarea';

          const selector = cssPath(el);
          if (seen.has(selector + '|' + label)) continue;
          seen.add(selector + '|' + label);

          out.push({
            kind,
            text: label,
            selector,
            href: tag === 'a' ? el.href : undefined,
            box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          });
        }

        return {
          elements: out,
          info: {
            title: document.title,
            url: location.href,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            scrollY: Math.round(window.scrollY),
            scrollHeight: document.body ? document.body.scrollHeight : 0
          }
        };
      }, { maxEls: maxElements, isFullPage: fullPage }).catch(() => ({ elements: [], info: {} }));

      elements = data.elements || [];
      pageInfo = data.info || {};
    }

    let domText = undefined;
    if (includeDomText) {
      domText = await page.evaluate(() => {
         return document.body ? document.body.innerText : '';
      }).catch(() => '');
    }

    // 3. Optionally save the image too
    let savedTo = null;
    if (savePath) {
      const dir = path.dirname(savePath);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, buffer);
      savedTo = savePath;
    }

    notifyProgress('see_page', 'completed',
      `👁️ Saw the page: ${elements.length} interactive elements visible${savedTo ? ' (saved ' + savedTo + ')' : ''}`);

    const base64 = Buffer.from(buffer).toString('base64');
    const summary = {
      success: true,
      url: pageInfo.url || page.url(),
      title: pageInfo.title,
      viewport: pageInfo.viewport,
      scroll: { y: pageInfo.scrollY, pageHeight: pageInfo.scrollHeight },
      visibleInteractiveElements: elements.length,
      domText,
      elements,
      savedTo
    };

    // Return BOTH the actual image (so the AI literally "sees" it) and the visual map text
    return {
      success: true,
      mcpContent: [
        { type: 'image', data: base64, mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' },
        { type: 'text', text: JSON.stringify(summary, null, 2) }
      ],
      ...summary
    };
  }
};

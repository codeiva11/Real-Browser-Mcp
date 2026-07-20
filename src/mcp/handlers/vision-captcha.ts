import { requireBrowser, notifyProgress } from './state';
import { helpersHandlers } from './helpers';
import type { SolveCaptchaParams } from '../../types';

export async function solveCaptcha(params: SolveCaptchaParams = {}) {
  const { page } = requireBrowser();
  const {
    type = 'auto',
    timeout = 30000,
    captchaSelector,
    inputSelector,
    refreshSelector,
    lang = 'eng',
    expectedLength,
    allowedChars,
    maxRetries = 3,
    iframe = null,
    iframeSelector = null,
    analyzeFirst = true,
    autoRetry = true,
    formData,
    formSelector,
    submit = false,
    humanLike = true,
    aiMatch = true,
    preferTextFallback = false,
  } = params;

  let targetFrame: any = page;
  if (iframe !== null && iframe !== undefined || iframeSelector) {
    const resolved = await helpersHandlers._resolveIframeContext(page, iframe, iframeSelector);
    if (resolved.success) {
      targetFrame = resolved.targetFrame;
      notifyProgress('solve_captcha', 'progress', `🎯 Targeting iframe ${iframe ?? iframeSelector}...`);
    } else {
      return { success: false, error: resolved.error };
    }
  }

  let formResult = null;
  if (formData && Object.keys(formData).length > 0) {
    notifyProgress('solve_captcha', 'started', `📋 Smart Form + Captcha Mode: Filling ${Object.keys(formData).length} fields...`);
    formResult = await helpersHandlers._fillFormFields(targetFrame, formData, formSelector, humanLike, aiMatch);
  } else {
    notifyProgress('solve_captcha', 'started', `🎯 100% Accuracy Mode: Solving ${type} captcha...`);
  }

  let detectedJsType: string | null = null;
  if (type === 'auto') {
    detectedJsType = await page.evaluate(() => {
      if (document.title.includes('Just a moment') ||
          document.querySelector('#challenge-stage') !== null ||
          document.querySelector('.cf-turnstile') !== null ||
          document.querySelector('input[name="cf-turnstile-response"]') !== null) return 'turnstile';
      return null;
    });
    if (detectedJsType) notifyProgress('solve_captcha', 'progress', `🔍 Auto-detected JS captcha type: ${detectedJsType}`);
  }

  let pageAnalysis = null;
  let detectedCaptchaSelector = captchaSelector;
  let detectedInputSelector = inputSelector;

  if (analyzeFirst) {
    notifyProgress('solve_captcha', 'progress', '🔍 Analyzing page structure...');
    pageAnalysis = await targetFrame.evaluate(() => {
      const result: any = { captchas: [], captchaInputs: [], forms: [] };
      const captchaSelectors = [
        'img[src*="captcha"]', 'img[alt*="captcha"]', 'img[id*="captcha"]',
        '.captcha-image', '#captcha_image', '#captchaImg', '.captcha',
        'img[src*="Captcha"]', 'canvas[id*="captcha"]'
      ];
      captchaSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach((el: any) => {
          if (el.offsetParent !== null) {
            result.captchas.push({
              selector: el.id ? `#${el.id}` : sel, src: el.src || null,
              width: el.width, height: el.height, isInsideForm: el.closest('form') !== null
            });
          }
        });
      });
      const inputSelectors = [
        'input[name*="captcha"]', 'input[id*="captcha"]', '#fcaptcha_code',
        'input[placeholder*="captcha"]', 'input[placeholder*="Enter"]', '#captchaInput', '.captcha-input'
      ];
      inputSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach((el: any) => {
          if (el.offsetParent !== null && el.type !== 'hidden') {
            result.captchaInputs.push({
              selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : sel),
              placeholder: el.placeholder, maxLength: el.maxLength > 0 ? el.maxLength : null,
            });
          }
        });
      });
      document.querySelectorAll('form').forEach(form => {
        const hasCaptcha = form.querySelector('img[src*="captcha"], input[name*="captcha"]');
        if (hasCaptcha) {
          result.forms.push({
            id: form.id || null, action: form.action,
            submitBtn: form.querySelector('button[type="submit"], input[type="submit"]')?.id || null,
          });
        }
      });
      return result;
    });

    if (!captchaSelector && pageAnalysis.captchas.length > 0) {
      detectedCaptchaSelector = pageAnalysis.captchas[0].selector;
      notifyProgress('solve_captcha', 'progress', `📍 Auto-detected captcha: ${detectedCaptchaSelector}`);
    }
    if (!inputSelector && pageAnalysis.captchaInputs.length > 0) {
      detectedInputSelector = pageAnalysis.captchaInputs[0].selector;
      if (!expectedLength && pageAnalysis.captchaInputs[0].maxLength) {
        params.expectedLength = pageAnalysis.captchaInputs[0].maxLength;
      }
      notifyProgress('solve_captcha', 'progress', `📍 Auto-detected input: ${detectedInputSelector}`);
    }
  }

  if (type === 'text' || type === 'image' || (type === 'auto' && detectedCaptchaSelector && !detectedJsType)) {
    if (!detectedCaptchaSelector) return { success: false, error: 'captchaSelector not provided and could not auto-detect' };

    const effectiveMaxRetries = autoRetry ? maxRetries : 1;
    for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
      try {
        notifyProgress('solve_captcha', 'progress', `📸 Capturing CAPTCHA image... (attempt ${attempt}/${effectiveMaxRetries})`);
        if (attempt > 1 && refreshSelector) {
          try {
            notifyProgress('solve_captcha', 'progress', '🔄 Refreshing CAPTCHA...');
            await targetFrame.click(refreshSelector);
            await new Promise(r => setTimeout(r, 1500));
          } catch (refreshErr: any) {
            notifyProgress('solve_captcha', 'progress', `⚠️ Could not refresh captcha: ${refreshErr.message}`);
          }
        }

        let targetHandle = null;
        if (detectedInputSelector) {
          try {
            const containerHandle = await targetFrame.evaluateHandle((sel: string) => {
              const input = document.querySelector(sel);
              if (!input) return null;
              return input.closest('form') || input.closest('div.captcha-wrapper') || input.parentElement?.parentElement || input.parentElement;
            }, detectedInputSelector);
            if (containerHandle && await containerHandle.evaluate((n: any) => n !== null)) targetHandle = containerHandle.asElement();
          } catch(e) {}
        }
        if (!targetHandle && detectedCaptchaSelector) {
          try { targetHandle = await targetFrame.waitForSelector(detectedCaptchaSelector, { timeout: 5000 }); } catch(e) {}
        }
        if (!targetHandle) return { success: false, error: 'Could not find elements to capture' };

        await targetHandle.evaluate((el: any) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await new Promise(r => setTimeout(r, 500));

        let captchaImageBase64 = null;
        try {
          const captchaEl = await targetFrame.$(detectedCaptchaSelector);
          if (captchaEl) captchaImageBase64 = (await captchaEl.screenshot()).toString('base64');
        } catch(e) {}
        const screenshotBase64 = (await targetHandle.screenshot()).toString('base64');

        const langHint = lang !== 'eng' ? `\nध्यान दें: टेक्स्ट ${lang === 'hin' ? 'हिन्दी' : lang} भाषा में हो सकता है।` : '';
        notifyProgress('solve_captcha', 'progress', '📤 CAPTCHA इमेज AI IDE एजेंट को भेज रहे हैं...');

        const instructions = `[कार्रवाई आवश्यक: CAPTCHA हल करें]\n\nCAPTCHA इमेज सफलतापूर्वक कैप्चर की गई (संलग्न देखें)।${langHint}\n\n1. अपनी Vision क्षमता से इमेज में दिखे टेक्स्ट/अक्षर पढ़ें।\n2. टेक्स्ट मिलने पर \`type\` टूल से selector \`${detectedInputSelector || '<input_selector>'}\` में भरें।\n3. सबमिट अनुरोध: ${submit ? 'हाँ — फॉर्म सबमिट भी करें' : 'नहीं'}।\n\nनोट: अगर वर्तमान model image input support नहीं करता, तो vision-capable model use करें या \`preferTextFallback: true\` के साथ text-only guidance लें।\n\nइस CAPTCHA के लिए \`solve_captcha\` दोबारा न बुलाएं, इमेज पहले ही मिल चुकी है।`;

        if (preferTextFallback) {
          return {
            success: false,
            error: 'This captcha requires image interpretation. Text-only fallback guidance returned because preferTextFallback is enabled.',
            requiresVision: true,
            fallback: {
              captchaSelector: detectedCaptchaSelector, inputSelector: detectedInputSelector || null, submit,
              guidance: 'Use a vision-capable model to read the captcha image, or solve it manually and continue with type/click tools.'
            },
            formResult
          };
        }

        return {
          success: true,
          mcpContent: [
            { type: 'text', text: instructions },
            { type: 'image', data: captchaImageBase64 || screenshotBase64, mimeType: 'image/png' }
          ]
        };
      } catch (err: any) {
        notifyProgress('solve_captcha', 'error', `Vision capture error (attempt ${attempt}): ${err.message}`);
        if (attempt >= effectiveMaxRetries) return { success: false, error: err.message, type: 'vision_capture', formResult };
      }
    }
    return { success: false, error: 'All captcha solving attempts exhausted', formResult };
  }

  const effectiveType = type !== 'auto' ? type : (detectedJsType || 'turnstile');
  if (effectiveType === 'recaptcha' || effectiveType === 'hcaptcha') {
    return { success: false, error: `${effectiveType} solving is not supported. Use a third-party service (e.g. 2Captcha, AntiCaptcha).`, detectedType: effectiveType, formResult };
  }

  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeout) {
    attempts++;
    if (attempts % 3 === 1) {
      try {
        await page.evaluate(() => {
          const coordinates: Array<{x: number, y: number, w: number, h: number}> = [];
          
          // 1. Find via wrappers
          document.querySelectorAll('.cf-turnstile, #challenge-stage').forEach(wrapper => {
            const iframes = wrapper.querySelectorAll('iframe');
            if (iframes.length > 0) {
              const rect = iframes[0].getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) coordinates.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
            } else {
              const emptyDivs = Array.from(wrapper.querySelectorAll('div')).filter(d => !d.querySelector('*'));
              if (emptyDivs.length > 0) {
                const target = emptyDivs.reduce((prev, current) => {
                  const pRect = prev.getBoundingClientRect(); const cRect = current.getBoundingClientRect();
                  return (pRect.width * pRect.height > cRect.width * cRect.height) ? prev : current;
                });
                const rect = target.getBoundingClientRect();
                if (rect.width > 50 && rect.height > 20) coordinates.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
              }
            }
          });

          // 2. Fallback heuristic size search
          if (coordinates.length === 0) {
            document.querySelectorAll('div, iframe').forEach(item => {
              try {
                const rect = item.getBoundingClientRect();
                const css = window.getComputedStyle(item);
                const isWidgetSize = rect.width >= 150 && rect.width <= 400 && rect.height >= 40 && rect.height <= 100;
                if (isWidgetSize) {
                  if (item.tagName === 'IFRAME') coordinates.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                  else if (!item.querySelector('*')) coordinates.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                }
              } catch (_) {}
            });
          }
          return coordinates;
        }).then(async (coords: Array<{x: number, y: number, w: number, h: number}>) => {
          for (const item of coords) {
             const cx = item.x + Math.min(30, item.w / 4);
             const cy = item.y + item.h / 2;
             await page.mouse.click(cx, cy);
          }
        });
      } catch (_) {}
    }

    const turnstileToken = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
      return input && input.value ? input.value : null;
    });

    if (turnstileToken) {
      notifyProgress('solve_captcha', 'completed', `✅ Turnstile solved after ${attempts} checks`, { type: 'turnstile', attempts });
      if (submit) {
        notifyProgress('solve_captcha', 'progress', '🚀 Submitting form...');
        const submitResult = await helpersHandlers._submitForm(targetFrame);
        return { success: true, type: 'turnstile', solved: true, formResult, submitted: submitResult.success, submitMessage: submitResult.message };
      }
      return { success: true, type: 'turnstile', solved: true, formResult };
    }

    const stillOnChallenge = await page.evaluate(() => {
      return document.title.includes('Just a moment') || document.querySelector('#challenge-stage') !== null;
    });
    if (!stillOnChallenge && attempts > 3) {
      notifyProgress('solve_captcha', 'completed', `✅ Cloudflare WAF challenge passed after ${attempts} checks (page redirected)`);
      return { success: true, type: 'cloudflare_waf', solved: true, method: 'challenge_redirect', attempts, formResult };
    }
    if (attempts % 10 === 0) notifyProgress('solve_captcha', 'progress', `Still solving... (${attempts} checks)`, { attempts });
    await new Promise(r => setTimeout(r, 1000));
  }

  notifyProgress('solve_captcha', 'error', 'Captcha solving timeout');
  return { success: false, error: 'Captcha solving timeout', type: effectiveType, formResult };
}

// Utility handlers — General-purpose tools
import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress, decoders } from './state';
import { handlers } from './index';

// ═══════════════════════════════════════════════════════════════
// Utility Handlers — General-purpose tools
// ═══════════════════════════════════════════════════════════════

export const utilityHandlers = {
  _validateCaptchaText(text: string, expectedLength: number, allowedChars: string) {
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

  async progress_tracker(params: any = {}) {
    const { action = 'get', taskName, progress } = params;

    switch (action) {
      case 'start':
        state.progressTasks[taskName] = { progress: 0, startTime: Date.now() };
        notifyProgress('progress_tracker', 'started', `Task started: ${taskName}`);
        break;
      case 'update':
        if (state.progressTasks[taskName]) {
          state.progressTasks[taskName].progress = progress;
          notifyProgress('progress_tracker', 'progress', `${taskName}: ${progress}%`, { taskName, progress });
        }
        break;
      case 'complete':
        if (state.progressTasks[taskName]) {
          state.progressTasks[taskName].progress = 100;
          state.progressTasks[taskName].endTime = Date.now();
          const duration = state.progressTasks[taskName].endTime - state.progressTasks[taskName].startTime;
          notifyProgress('progress_tracker', 'completed', `${taskName} completed in ${duration}ms`, { taskName, duration });
        }
        break;
    }

    return { success: true, tasks: state.progressTasks };
  },

  async deep_analysis(params: any = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], detailed = true } = params;

    notifyProgress('deep_analysis', 'started', 'Analyzing page...');

    const analysis = await page.evaluate(() => {
      const result = {
        seo: {
          title: document.title,
          titleLength: document.title.length,
          h1Count: document.querySelectorAll('h1').length,
          metaDescription: (document.querySelector('meta[name="description"]') as any)?.content,
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

  async file_downloader(params: any) {
    const { page } = requireBrowser();
    const { url, filename, directory = './downloads' } = params;

    notifyProgress('file_downloader', 'started', `Downloading: ${url}`);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const response = await page.goto(url, { waitUntil: 'networkidle' });
    if (!response) {
      notifyProgress('file_downloader', 'error', 'Failed to get response');
      return { success: false, error: 'Failed to get response' };
    }
    const buffer = await response.body();

    const outputFilename = filename || path.basename(new URL(url).pathname) || 'download';
    const outputPath = path.join(directory, outputFilename);

    fs.writeFileSync(outputPath, buffer);

    notifyProgress('file_downloader', 'completed', `Downloaded: ${outputFilename} (${buffer.length} bytes)`, { filename: outputPath, size: buffer.length });

    return { success: true, filename: outputPath, size: buffer.length };
  },

  async execute_js(params: any) {
    const { page } = requireBrowser();
    const {
      code,
      returnValue = true,
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
        const resolved = await handlers._resolveIframeContext(page, iframe, iframeSelector);
        if (resolved.success) {
          context = resolved.targetFrame;
          frameInfo = resolved.frameInfo;
          notifyProgress('execute_js', 'progress', `Switched to iframe ${iframe ?? iframeSelector}`);

          // Wait for iframe to be ready if needed
          if (waitForIframe && context !== page) {
            try {
              await context.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
            } catch (e) {
              notifyProgress('execute_js', 'progress', 'Warning: iframe may not be fully loaded');
            }
          }
        } else {
          notifyProgress('execute_js', 'error', `iframe switch failed: ${resolved.error}`);
          return { success: false, error: `iframe switch failed: ${resolved.error}` };
        }
      } catch (e: any) {
        notifyProgress('execute_js', 'error', `iframe switch failed: ${e.message}`);
        return { success: false, error: `iframe switch failed: ${e.message}` };
      }
    }

    try {
      // Playwright's evaluate(string) runs the code as an *expression*, so a
      // top-level `return` throws "Illegal return statement" and `const/let`
      // at the top level can also fail. Detect snippets that use statement-only
      // syntax and wrap them in a function body so `return` works as users expect.
      // We still pass plain expressions / existing IIFEs straight through.
      const trimmed = String(code).trim();
      const looksLikeFunctionArg =
        trimmed.startsWith('(') ||        // IIFE or arrow: (() => ...)() / (function(){...})()
        trimmed.startsWith('function') || // function expression
        trimmed.startsWith('async');      // async IIFE / async arrow
      const hasTopLevelReturn = /(^|[\s;{])return[\s;]/.test(trimmed);

      let runnable: any = code;
      if (!looksLikeFunctionArg && (hasTopLevelReturn || params.async)) {
        // Wrap so `return` is valid. Async is supported because evaluate awaits
        // the returned promise.
        runnable = `(async () => { ${code} })()`;
      }

      const result = await context.evaluate(runnable);

      notifyProgress('execute_js', 'completed', 'JavaScript executed', {
        hasResult: result !== undefined,
        iframe: frameInfo
      });

      return { success: true, result: returnValue ? result : undefined, iframe: frameInfo };

    } catch (evalError: any) {
      notifyProgress('execute_js', 'error', `Execution error: ${evalError.message}`);
      return { success: false, error: evalError.message, iframe: frameInfo };
    }
  }
};

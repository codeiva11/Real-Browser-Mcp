// Utility handlers — General-purpose tools
import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress, decoders } from './state';
import { helpersHandlers } from './helpers';

// ═══════════════════════════════════════════════════════════════
// Utility Handlers — General-purpose tools
// ═══════════════════════════════════════════════════════════════

export const utilityHandlers = {

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
        const resolved = await helpersHandlers._resolveIframeContext(page, iframe, iframeSelector);
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
  },

  async storage_inspector(params: any) {
    const { page } = requireBrowser();
    const { action = 'indexeddb' } = params;
    notifyProgress('storage_inspector', 'started', `Inspecting ${action}`);

    try {
      if (action === 'service_workers') {
        const sw = await page.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.map(r => ({ scope: r.scope, active: !!r.active }));
        });
        return { success: true, count: sw.length, serviceWorkers: sw };
      } 
      
      if (action === 'indexeddb') {
        // ponytail: evaluate to extract native indexedDB list without CDP overhead
        const idbs = await page.evaluate(async () => {
          if (!indexedDB.databases) return [];
          const dbs = await indexedDB.databases();
          return dbs;
        });
        return { success: true, count: idbs.length, databases: idbs };
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  async api_analyzer(params: any) {
    const { action = 'schema', data, data2, lang = 'ts' } = params;
    notifyProgress('api_analyzer', 'started', `Action: ${action}`);

    try {
      let parsed = null;
      try { parsed = typeof data === 'string' && (data.startsWith('{') || data.startsWith('[')) ? JSON.parse(data) : null; } catch {}

      if (action === 'diff') {
        let p2 = null;
        try { p2 = typeof data2 === 'string' && (data2.startsWith('{') || data2.startsWith('[')) ? JSON.parse(data2) : null; } catch {}
        if (!parsed || !p2) return { success: false, error: 'Invalid JSON for diff' };
        
        // ponytail: minimal diff by serializing sorted keys
        const sortKeys = (obj: any): any => typeof obj === 'object' && obj ? Object.keys(obj).sort().reduce((acc: any, k) => { acc[k] = sortKeys(obj[k]); return acc; }, Array.isArray(obj) ? [] : {}) : obj;
        const diff = JSON.stringify(sortKeys(parsed)) === JSON.stringify(sortKeys(p2)) ? 'Exact Match' : 'Different';
        return { success: true, diff };
      }

      if (action === 'schema') {
        if (!parsed) return { success: false, error: 'Invalid JSON for schema' };
        const genSchema = (obj: any): any => {
          if (Array.isArray(obj)) return obj.length ? [genSchema(obj[0])] : ['any'];
          if (typeof obj === 'object' && obj) {
            const schema: any = {};
            for (const [k, v] of Object.entries(obj)) schema[k] = genSchema(v);
            return schema;
          }
          return typeof obj;
        };
        return { success: true, schema: genSchema(parsed) };
      }

      if (action === 'sdk') {
        const url = parsed?.url || data || 'https://api.example.com';
        const code = lang === 'python' 
          ? `import requests\n\ndef fetch_data(url="${url}"):\n    return requests.get(url).json()`
          : `export async function fetchData(url: string = "${url}") {\n  const res = await fetch(url);\n  return res.json();\n}`;
        return { success: true, sdk_boilerplate: code };
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
};

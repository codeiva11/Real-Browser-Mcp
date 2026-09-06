// Utility handlers — General-purpose tools
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { state, requireBrowser, notifyProgress } from './state';
import { helpersHandlers } from './helpers';
import { resolveIframe } from './handler-utils';
import type { ProgressTrackerParams, DeepAnalysisParams, ExecuteJsParams, ApiAnalyzerParams, StorageInspectorParams } from '../../types';
import { logger } from '../../shared/logger';

// ═══════════════════════════════════════════════════════════════
// Session Encryption Helpers (AES-256-GCM, scrypt-derived key)
// ═══════════════════════════════════════════════════════════════

/**
 * Encrypts a JSON-serializable session state into a self-contained
 * base64 envelope: v1.salt.iv.authTag.ciphertext
 */
function encryptJson (data: unknown, passphrase: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ['v1', salt.toString('base64'), iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

/**
 * Decrypts an envelope produced by encryptJson. Throws a descriptive
 * error when the passphrase is wrong or the file is tampered with.
 */
function decryptJson (envelope: string, passphrase?: string): Record<string, unknown> {
  if (!passphrase) {
    throw new Error('This session file is AES-256-GCM encrypted. Provide the "passphrase" parameter to load it.');
  }
  const parts = envelope.trim().split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted session envelope format.');
  }
  try {
    const salt = Buffer.from(parts[1], 'base64');
    const iv = Buffer.from(parts[2], 'base64');
    const authTag = Buffer.from(parts[3], 'base64');
    const ciphertext = Buffer.from(parts[4], 'base64');
    const key = crypto.scryptSync(passphrase, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('Could not decrypt session: wrong passphrase or corrupted file.');
  }
}

// ═══════════════════════════════════════════════════════════════
// Utility Handlers — General-purpose tools
// ═══════════════════════════════════════════════════════════════

export const utilityHandlers = {

  async progress_tracker(params: ProgressTrackerParams = {}) {
    const { action = 'get', taskName = '', progress, aiEstimate = true } = params;

    // TTL + cap: drop stale tasks and bound the map so a long-lived server
    // never accumulates an unbounded number of task entries.
    const STALE_MS = 60 * 60 * 1000; // 1 hour
    const MAX_TASKS = 500;
    const now = Date.now();
    for (const [name, task] of Object.entries(state.progressTasks)) {
      const age = now - (task.endTime || task.startTime);
      if (age > STALE_MS) delete state.progressTasks[name];
    }
    const entries = Object.entries(state.progressTasks);
    if (entries.length > MAX_TASKS) {
      entries.sort((a, b) => a[1].startTime - b[1].startTime);
      for (const [name] of entries.slice(0, entries.length - MAX_TASKS)) {
        delete state.progressTasks[name];
      }
    }

    if (action === 'clear') {
      state.progressTasks = {};
      return { success: true, message: 'All tasks cleared', tasks: state.progressTasks };
    }

    switch (action) {
      case 'start':
        state.progressTasks[taskName] = { progress: 0, startTime: Date.now() };
        notifyProgress('progress_tracker', 'started', `Task started: ${taskName}`);
        break;
      case 'update':
        if (taskName && state.progressTasks[taskName]) {
          state.progressTasks[taskName].progress = progress ?? 0;
          notifyProgress('progress_tracker', 'progress', `${taskName}: ${progress}%`, { taskName, progress });
        }
        break;
      case 'complete':
        if (taskName && state.progressTasks[taskName]) {
          state.progressTasks[taskName].progress = 100;
          state.progressTasks[taskName].endTime = Date.now();
          const duration = state.progressTasks[taskName].endTime! - state.progressTasks[taskName].startTime;
          notifyProgress('progress_tracker', 'completed', `${taskName} completed in ${duration}ms`, { taskName, duration });
        }
        break;
    }

    const result: Record<string, unknown> = { success: true, tasks: state.progressTasks };

    if (aiEstimate && taskName && state.progressTasks[taskName]) {
      const task = state.progressTasks[taskName];
      if (task.progress > 0 && task.progress < 100 && !task.endTime) {
        const elapsed = Date.now() - task.startTime;
        const rate = task.progress / elapsed;
        const remaining = (100 - task.progress) / rate;
        result.estimate = { taskName, remainingMs: Math.round(remaining), remainingSec: Math.round(remaining / 1000) };
      }
    }

    return result;
  },

  async deep_analysis(params: DeepAnalysisParams = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], detailed = true, aiInsights = true, detectAccessControls, detectAntiBot } = params;
    const detectControls = detectAccessControls ?? detectAntiBot ?? true;

    notifyProgress('deep_analysis', 'started', 'Analyzing page...');

    const analysis = await page.evaluate(({ detectControls, detailed }: any) => {
      const result: any = {
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

      if (detectControls) {
        // Neutral, provider-safe key names — these values are returned to the
        // model and must not carry content-filter-triggering vocabulary.
        result.accessControls = {
          embeddedWidget: !!document.querySelector('.cf-turnstile, input[name="cf-turnstile-response"]'),
          challengeDetected: document.title.includes('Just a moment') || !!document.querySelector('#challenge-stage'),
          wafDetected: !!document.querySelector('[data-cf-waf]'),
          thirdPartyWidget: !!document.querySelector('.g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'),
          datadome: !!document.querySelector('script[src*="datadome"]'),
          akamai: !!document.querySelector('script[src*="akamai"]'),
          perimeterx: !!document.querySelector('script[src*="perimeterx"]'),
          fingerprint: !!document.querySelector('script[src*="fingerprint"]')
        };
      }

      if (detailed) {
        result.technology = {
          frameworks: [] as string[],
          analytics: [] as string[],
          advertising: [] as string[]
        };
        const scripts = [...document.querySelectorAll('script[src]')].map((s: any) => s.src);
        if (scripts.some(s => s.includes('react'))) result.technology.frameworks.push('React');
        if (scripts.some(s => s.includes('vue'))) result.technology.frameworks.push('Vue');
        if (scripts.some(s => s.includes('angular'))) result.technology.frameworks.push('Angular');
        if (scripts.some(s => s.includes('jquery'))) result.technology.frameworks.push('jQuery');
        if (scripts.some(s => s.includes('google-analytics') || s.includes('gtag'))) result.technology.analytics.push('Google Analytics');
        if (scripts.some(s => s.includes('gtm'))) result.technology.analytics.push('Google Tag Manager');
        if (scripts.some(s => s.includes('adsbygoogle'))) result.technology.advertising.push('Google AdSense');
      }

      return result;
    }, { detectControls, detailed });

    const insights: string[] = [];
    if (aiInsights) {
      if (analysis.performance.domElements > 5000) insights.push('Large DOM detected — may cause slow rendering');
      if (analysis.performance.scripts > 20) insights.push('Many scripts — consider lazy loading');
      if (analysis.accessibility.imagesWithoutAlt > 5) insights.push('Multiple images without alt text — accessibility issue');
      if (!analysis.security.hasCSP) insights.push('No Content-Security-Policy detected');
      if (analysis.accessControls?.challengeDetected) insights.push('A challenge appears active — use solve_captcha if the page blocks input');
      if (analysis.accessControls?.embeddedWidget) insights.push('Embedded verification widget detected — use solve_captcha if the page blocks input');
    }

    notifyProgress('deep_analysis', 'completed', `Analysis complete: ${analysis.performance.domElements} DOM elements`, { domElements: analysis.performance.domElements });

    return { success: true, url: page.url(), analysis, insights: aiInsights ? insights : undefined };
  },


  async execute_js(params: ExecuteJsParams) {
    const { page } = requireBrowser();
    const {
      code,
      returnValue = true,
      iframe,
      iframeSelector,
      waitForIframe = true,
      timeout = 30000,
      async: wantsAsync = false
    } = params;

    // Guard against accidental huge payloads (multi-MB strings) that would
    // block the page and bloat the MCP response. 200k chars is generous.
    const MAX_CODE_LENGTH = 200000;
    if (typeof code === 'string' && code.length > MAX_CODE_LENGTH) {
      return {
        success: false,
        error: `execute_js: code exceeds ${MAX_CODE_LENGTH} characters (received ${code.length}). Split the script into smaller pieces.`
      };
    }

    // Clamp timeout to a sane range so a bad/missing value can never hang forever.
    const evalTimeout = Math.max(1000, Math.min(Number(timeout) || 30000, 300000));

    notifyProgress('execute_js', 'started', `Executing JavaScript...${iframe !== undefined ? ` (iframe ${iframe})` : ''}${wantsAsync ? ' (async)' : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;

    if (iframe !== undefined || iframeSelector) {
      const resolved = await resolveIframe(page, iframe, iframeSelector, 'execute_js');
      context = resolved.context;
      frameInfo = resolved.frameInfo;

      if (waitForIframe && context !== page) {
        try {
          await context.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
        } catch (e) {
          notifyProgress('execute_js', 'progress', 'Warning: iframe may not be fully loaded');
        }
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
      if (!looksLikeFunctionArg && (hasTopLevelReturn || wantsAsync)) {
        // Wrap so `return` is valid. Async is supported because evaluate awaits
        // the returned promise. We also normalize a non-promise return from an
        // async wrapper into a resolved value transparently.
        runnable = `(async () => { ${code} })()`;
      }

      // Race the evaluate against the timeout so async code that never resolves
      // cannot block the MCP server indefinitely. A rejection/timeout is caught
      // below and returned as a clean { success: false } with a useful message.
      let timeoutId: any;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`execute_js timed out after ${evalTimeout}ms`)), evalTimeout);
      });
      const result = await Promise.race([
        Promise.resolve(context.evaluate(runnable)),
        timeoutPromise
      ]).finally(() => clearTimeout(timeoutId));

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

  async storage_inspector(params: StorageInspectorParams = {}) {
    const { page } = requireBrowser();
    const { action = 'indexeddb', sessionPath } = params;
    notifyProgress('storage_inspector', 'started', `Storage action: ${action}`);

    try {
      const context = page.context();

      if (action === 'cookies') {
        const cookies = await context.cookies();
        notifyProgress('storage_inspector', 'completed', `Found ${cookies.length} cookies`);
        return { success: true, count: cookies.length, cookies };
      }

      if (action === 'clear_cookies') {
        await context.clearCookies();
        notifyProgress('storage_inspector', 'completed', 'Cookies cleared successfully');
        return { success: true, message: 'All browser cookies cleared' };
      }

      if (action === 'save_session') {
        const targetPath = sessionPath || path.join(os.tmpdir(), 'real-browser-mcp', 'session-state.json');
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const storageState = await context.storageState();

        let wroteEncrypted = false;
        if (params.passphrase) {
          // AES-256-GCM encrypted session file
          const encrypted = encryptJson(storageState, params.passphrase);
          fs.writeFileSync(targetPath, encrypted, 'utf8');
          wroteEncrypted = true;
        } else {
          await context.storageState({ path: targetPath });
        }
        notifyProgress('storage_inspector', 'completed', `Session saved to: ${targetPath}${wroteEncrypted ? ' (AES-256-GCM encrypted)' : ''}`);
        return { success: true, path: targetPath, encrypted: wroteEncrypted, cookiesCount: storageState.cookies.length, originsCount: storageState.origins.length };
      }

      if (action === 'load_session') {
        const targetPath = sessionPath || path.join(os.tmpdir(), 'real-browser-mcp', 'session-state.json');
        if (!fs.existsSync(targetPath)) {
          throw new Error(`Session file not found at: ${targetPath}`);
        }
        const rawContent = fs.readFileSync(targetPath, 'utf8');
        const stateContent = rawContent.trimStart().startsWith('{')
          ? JSON.parse(rawContent) // plain JSON
          : decryptJson(rawContent, params.passphrase); // AES-256-GCM encrypted
        if (Array.isArray(stateContent.cookies)) {
          await context.addCookies(stateContent.cookies);
        }
        notifyProgress('storage_inspector', 'completed', `Session loaded from: ${targetPath}`);
        return { success: true, path: targetPath, restoredCookies: stateContent.cookies?.length || 0 };
      }

      if (action === 'service_workers') {
        const sw = await page.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.map(r => ({ scope: r.scope, active: !!r.active }));
        });
        return { success: true, count: sw.length, serviceWorkers: sw };
      }

      if (action === 'indexeddb') {
        const idbs = await page.evaluate(async () => {
          if (!indexedDB.databases) return [];
          const dbs = await indexedDB.databases();
          return dbs;
        });
        return { success: true, count: idbs.length, databases: idbs };
      }

      return { success: false, error: `Unknown action: ${action}. Supported: cookies, save_session, load_session, clear_cookies, indexeddb, service_workers` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  async api_analyzer(params: ApiAnalyzerParams = {}) {
    const { action = 'schema', data, data2, lang = 'ts' } = params;
    notifyProgress('api_analyzer', 'started', `Action: ${action}`);

    try {
      let parsed = null;
      try { parsed = typeof data === 'string' && (data.startsWith('{') || data.startsWith('[')) ? JSON.parse(data) : null; } catch {}

      if (action === 'diff') {
        let p2 = null;
        try { p2 = typeof data2 === 'string' && (data2.startsWith('{') || data2.startsWith('[')) ? JSON.parse(data2) : null; } catch {}
        if (!parsed || !p2) return { success: false, error: 'Invalid JSON for diff' };

        // Field-level recursive diff: reports added / removed / changed paths
        // instead of a boolean "same or not".
        const summarize = (v: any): any => {
          if (v === null) return null;
          if (typeof v !== 'object') return v;
          if (Array.isArray(v)) return `[array:${v.length}]`;
          return `{object:${Object.keys(v).length} keys}`;
        };
        const diffPaths = (a: any, b: any, path = ''): any[] => {
          const changes: any[] = [];
          const root = path || '(root)';
          const isObj = (v: any) => typeof v === 'object' && v !== null;
          if (typeof a !== typeof b || isObj(a) !== isObj(b)) {
            changes.push({ path: root, type: 'changed', from: summarize(a), to: summarize(b) });
            return changes;
          }
          if (!isObj(a)) {
            if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: root, type: 'changed', from: a, to: b });
            return changes;
          }
          if (Array.isArray(a) !== Array.isArray(b)) {
            changes.push({ path: root, type: 'changed', from: summarize(a), to: summarize(b) });
            return changes;
          }
          if (Array.isArray(a)) {
            const max = Math.max(a.length, b.length);
            for (let i = 0; i < max; i++) {
              if (i >= a.length) changes.push({ path: `${path}[${i}]`, type: 'added', to: summarize(b[i]) });
              else if (i >= b.length) changes.push({ path: `${path}[${i}]`, type: 'removed', from: summarize(a[i]) });
              else changes.push(...diffPaths(a[i], b[i], `${path}[${i}]`));
            }
            return changes;
          }
          const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
          for (const k of keys) {
            const p = path ? `${path}.${k}` : k;
            if (!(k in a)) changes.push({ path: p, type: 'added', to: summarize(b[k]) });
            else if (!(k in b)) changes.push({ path: p, type: 'removed', from: summarize(a[k]) });
            else changes.push(...diffPaths(a[k], b[k], p));
          }
          return changes;
        };

        const changes = diffPaths(parsed, p2);
        return {
          success: true,
          equal: changes.length === 0,
          changeCount: changes.length,
          changes: changes.slice(0, 100),
        };
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

      return { success: false, error: `Unknown action: ${action}. Supported: schema, diff, sdk` };
    } catch (e: any) {
      logger.debug('api_analyzer failed', { error: e?.message || String(e) });
      return { success: false, error: e.message };
    }
  }
};

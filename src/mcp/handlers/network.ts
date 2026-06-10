import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil } from './state';
import { handlers } from './index';

// Auto-generated network handlers

export const networkHandlers = {
  async redirect_tracer(params: any) {
    const { page } = requireBrowser();
    const { url, maxRedirects = 20, includeHeaders = false, followJS = true, timeout = 30000 } = params;

    notifyProgress('redirect_tracer', 'started', `Tracing redirects for: ${url}`);

    const redirects: any[] = [];
    const jsNavigations: any[] = [];
    let currentUrl = url;

    // HTTP redirect handler
    const responseHandler = (response: any) => {
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
    const frameNavigatedHandler = (frame: any) => {
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
      await page.goto(url, { waitUntil: 'networkidle', timeout });

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
          const links: any[] = [];
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
    } catch (e: any) {
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

  async network_recorder(params: any = {}) {
    const { page } = requireBrowser();
    const { action = 'get', filter = {}, captureResponses = false } = params;

    switch (action) {
      case 'start':
        state.networkRecords = [];
        state.isRecordingNetwork = true;

        // ====== FEATURE 2: Pre-page-load Runtime API Interception ======
        // Inject BEFORE any JS runs — catches calls from obfuscated/webpack code
        try {
          await page.addInitScript(() => {
            window.__interceptedApis = [];
            window.__wsMessages = [];

            // --- Monkey-patch fetch ---
            const origFetch = window.fetch;
            window.fetch = function (...args: any[]) {
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
              return origFetch.apply(this, args as any);
            };

            // --- Monkey-patch XMLHttpRequest ---
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
              (this as any).__iUrl = url; (this as any).__iMethod = method; (this as any).__iHeaders = {};
              return origOpen.apply(this, [method, url, ...rest] as any);
            };
            XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
              if ((this as any).__iHeaders) (this as any).__iHeaders[name] = value;
              return origSetHeader.apply(this, [name, value]);
            };
            XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
              try {
                window.__interceptedApis.push({
                  type: 'xhr', url: (this as any).__iUrl, method: (this as any).__iMethod,
                  headers: (this as any).__iHeaders || null,
                  body: typeof body === 'string' ? body.substring(0, 2000) : null,
                  timestamp: Date.now()
                });
              } catch (e) { }
              return origSend.apply(this, [body]);
            };

            // --- Monkey-patch navigator.sendBeacon ---
            if (navigator.sendBeacon) {
              const origBeacon = navigator.sendBeacon.bind(navigator);
              navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
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
            const OrigWS: any = window.WebSocket;
            window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
              const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
              const wsId = window.__wsMessages.length;
              const wsEntry: any = { id: wsId, url, openedAt: Date.now(), messages: [], status: 'connecting' };
              window.__wsMessages.push(wsEntry);

              ws.addEventListener('open', () => { wsEntry.status = 'open'; });
              ws.addEventListener('close', (e: any) => { wsEntry.status = 'closed'; wsEntry.closedAt = Date.now(); wsEntry.closeCode = e.code; });
              ws.addEventListener('error', () => { wsEntry.status = 'error'; });
              ws.addEventListener('message', (e: any) => {
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
              ws.send = function (data: any) {
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
            } as any;
            window.WebSocket.prototype = OrigWS.prototype;
            (window.WebSocket as any).CONNECTING = OrigWS.CONNECTING;
            (window.WebSocket as any).OPEN = OrigWS.OPEN;
            (window.WebSocket as any).CLOSING = OrigWS.CLOSING;
            (window.WebSocket as any).CLOSED = OrigWS.CLOSED;
          });
        } catch (e) { /* addInitScript may fail on already-loaded pages, that's OK */ }

        // Request handler
        page.on('request', req => {
          if (state.isRecordingNetwork) {
            state.networkRecords.push({
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
          if (state.isRecordingNetwork) {
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

            const record: any = {
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

            state.networkRecords.push(record);
          }
        });

        // Frame navigation handler for JS redirects
        page.on('framenavigated', frame => {
          if (state.isRecordingNetwork && frame === page.mainFrame()) {
            state.networkRecords.push({
              type: 'navigation',
              url: frame.url(),
              timestamp: Date.now()
            });
          }
        });

        notifyProgress('network_recorder', 'started', 'Power recording started (requests + responses + API interception + WebSocket + navigations)');
        break;

      case 'stop':
        state.isRecordingNetwork = false;
        notifyProgress('network_recorder', 'completed', `Recording stopped: ${state.networkRecords.length} events captured`);
        break;

      case 'clear':
        state.networkRecords = [];
        // Also clear intercepted data
        try { await page.evaluate(() => { window.__interceptedApis = []; window.__wsMessages = []; }); } catch (e) { }
        notifyProgress('network_recorder', 'completed', 'Network records cleared');
        break;

      case 'get_media':
        // Special action to get only media URLs
        const mediaRecords = state.networkRecords.filter(r => r.isMedia);
        return {
          success: true,
          count: mediaRecords.length,
          mediaUrls: mediaRecords.map(r => ({ url: r.url, type: r.mediaType }))
        };

      case 'get_navigations':
        // Get only navigation events (for tracking JS redirects)
        const navRecords = state.networkRecords.filter(r => r.type === 'navigation');
        return {
          success: true,
          count: navRecords.length,
          navigations: navRecords
        };

      case 'get_api_calls': {
        const apiRecords = state.networkRecords.filter(r => r.isApiCall);
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
        } catch (e: any) {
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
        } catch (e: any) {
          return { success: false, error: 'Failed to retrieve WebSocket data: ' + e.message, websockets: [] };
        }
      }
    }

    let records = state.networkRecords;
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

    return { success: true, recording: state.isRecordingNetwork, count: records.length, records: records.slice(-200) };
  },

  async cookie_manager(params: any = {}) {
    const { page } = requireBrowser();
    const { action = 'get', name, value, domain, expires } = params;

    notifyProgress('cookie_manager', 'started', `Cookie action: ${action}`);

    // Playwright/Patchright: cookies are managed via the BrowserContext, not the page
    const context = page.context();

    switch (action) {
      case 'get': {
        const cookies = await context.cookies();
        notifyProgress('cookie_manager', 'completed', `Retrieved ${cookies.length} cookies`);
        return { success: true, cookies: name ? cookies.filter(c => c.name === name) : cookies };
      }

      case 'set': {
        await context.addCookies([{
          name,
          value,
          domain: domain || new URL(page.url()).hostname,
          path: '/',
          ...(expires ? { expires } : {})
        }]);
        notifyProgress('cookie_manager', 'completed', `Cookie set: ${name}`);
        return { success: true, message: `Cookie ${name} set` };
      }

      case 'delete': {
        // Playwright has no per-cookie delete: clear all, then re-add the ones we keep
        const toDelete = await context.cookies();
        const remaining = name ? toDelete.filter(c => c.name !== name) : [];
        const removedCount = toDelete.length - remaining.length;
        await context.clearCookies();
        if (remaining.length) {
          await context.addCookies(remaining.map(c => ({
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
            httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite
          })));
        }
        notifyProgress('cookie_manager', 'completed', `Deleted ${removedCount} cookie(s)`);
        return { success: true, message: `Deleted ${removedCount} cookie(s)` };
      }

      case 'clear': {
        const allCookies = await context.cookies();
        await context.clearCookies();
        notifyProgress('cookie_manager', 'completed', `Cleared ${allCookies.length} cookies`);
        return { success: true, message: `Cleared ${allCookies.length} cookies` };
      }
    }

    return { success: false, error: 'Invalid action' };
  },

  async extract_data(params: any = {}) {
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

    const results: any = {
      success: true,
      type,
      url: page.url(),
      extracted: {}
    };

    // Helper: Extract regex matches
    const extractRegex = async (regexPattern: any, regexFlags: any, contentSource: any) => {
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
    const extractJson = async (jsonSource: any, sel?: any, path?: any) => {
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
        const getPath = (obj: any, pathStr: any) => {
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
    const extractMeta = async (metaTypes: any) => {
      const meta = await page.evaluate(([includeTitle, includeCanonical]: any) => {
        const result: any = { meta: {}, og: {}, twitter: {} };

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
      }, [includeTitle, includeCanonical]);

      // Filter by requested types
      const filtered: any = {};
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
    const extractStructured = async (sel: any, wait = false, timeout = 10000) => {
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
      const autoResults: any = {
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
        const tagCount = Object.values(results.extracted as Record<string, any>).reduce((sum: number, val: any) => {
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

        const deobfuscated: any = {
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
        const terserMappings: any = {};
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
        deobfuscated.urls = [...new Set(deobfuscated.decodedStrings.filter((s: any) =>
          s.match(/^(https?:\/\/|\/)/) || s.match(/\.(php|json|api|asp|jsp)$/i)
        ))].slice(0, 50);
        deobfuscated.apiEndpoints = [...new Set(deobfuscated.decodedStrings.filter((s: any) =>
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
        const apiResults: any = {
          fetchEndpoints: [], xhrEndpoints: [], formActions: [],
          scriptSources: [], inlineApiPatterns: [], postBodies: [], dynamicApis: []
        };

        // 1. Intercept runtime fetch/XHR
        try {
          const runtimeApis = await page.evaluate(() => {
            return new Promise((resolve) => {
              const found: any[] = [];
              if ((window as any).__capturedApis) { resolve((window as any).__capturedApis); return; }
              const origFetch = window.fetch;
              window.fetch = function (...args: any[]) {
                try {
                  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                  const opts = args[1] || {};
                  found.push({
                    type: 'fetch', url, method: opts.method || 'GET',
                    body: typeof opts.body === 'string' ? opts.body.substring(0, 500) : null
                  });
                } catch (e) { }
                return origFetch.apply(this, args as any);
              };
              const origOpen = XMLHttpRequest.prototype.open;
              const origSend = XMLHttpRequest.prototype.send;
              XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) { (this as any).__apiUrl = url; (this as any).__apiMethod = method; return origOpen.apply(this, [method, url, ...rest] as any); };
              XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
                found.push({
                  type: 'xhr', url: (this as any).__apiUrl, method: (this as any).__apiMethod,
                  body: typeof body === 'string' ? body.substring(0, 500) : null
                });
                return origSend.apply(this, [body]);
              };
              (window as any).__capturedApis = found;
              setTimeout(() => resolve(found), 3000);
            });
          });
          apiResults.dynamicApis = runtimeApis as any;
        } catch (e) { apiResults.dynamicApis = []; }

        // 2. Static analysis
        const allScriptContent = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
        }).catch(() => '');

        const fetchRegex = /fetch\s*\(\s*(?:['"`]([^'"`]+)['"`]|([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
        let fMatch;
        while ((fMatch = fetchRegex.exec(allScriptContent)) !== null) {
          apiResults.fetchEndpoints.push((fMatch[1] || fMatch[2]) as never);
        }
        apiResults.fetchEndpoints = [...new Set(apiResults.fetchEndpoints)].slice(0, 30);

        const xhrRegex = /\.open\s*\(\s*['"](?:GET|POST|PUT|DELETE)['"]\s*,\s*['"`]([^'"`]+)['"`]/gi;
        let xMatch;
        while ((xMatch = xhrRegex.exec(allScriptContent)) !== null) {
          apiResults.xhrEndpoints.push(xMatch[1] as never);
        }
        apiResults.xhrEndpoints = [...new Set(apiResults.xhrEndpoints)].slice(0, 30);

        apiResults.formActions = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('form[action]')).map((f: any) => ({ action: f.action, method: f.method || 'GET', id: f.id || null }));
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
        const decryptResults: any = {
          original: null, decoded: [], detectedEncoding: [], extractedKeys: [], aesDecrypted: null
        };

        // Get data to decrypt — from param or from page
        let dataToDecrypt = encryptedData;
        if (!dataToDecrypt) {
          // Try to get from clipboard or last API response
          const lastApiResponse = state.networkRecords.filter(r => r.responseBody).pop();
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
          const rot13 = dataToDecrypt.replace(/[a-zA-Z]/g, (c: any) => {
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
              const found: any[] = [];
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
                else keyBuf = Buffer.from(aesKey as string, keyEncoding as BufferEncoding);
                if (keyEncoding === 'utf8') { const kb = Buffer.from(aesKey as string, 'utf8'); kb.copy(keyBuf); }

                // Try to decode the data from base64 first
                const dataBuf = Buffer.from(dataToDecrypt as string, 'base64');
                if (dataBuf.length > 16) {
                  // IV might be first 16 bytes
                  const iv = params.aesIV ? Buffer.from(params.aesIV as string, keyEncoding as BufferEncoding) : dataBuf.slice(0, 16);
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
  }
};

import { requireBrowser, notifyProgress } from './state';

export async function extractData(params: any = {}) {
  const { page } = requireBrowser();
  const {
    type = 'auto', pattern, selector, jsonPath, source = 'all', autoDecode = true,
    flags = 'gi', types = ['all'], includeTitle = true, includeCanonical = true,
    maxMatches = 100, maxJsonObjects = 50, waitForSelector = false, selectorTimeout = 10000
  } = params;

  notifyProgress('extract_data', 'started', `Extracting data (type: ${type})...`);

  const results: any = { success: true, type, url: page.url(), extracted: {} };

  const extractRegex = async (regexPattern: any, regexFlags: any, contentSource: any) => {
    let content;
    if (contentSource === 'html') content = await page.content();
    else if (contentSource === 'scripts') content = await page.$$eval('script', (scripts: any) => scripts.map((s: any) => s.textContent).join('\n'));
    else if (contentSource === 'text') content = await page.evaluate(() => document.body.innerText);
    else {
      const html = await page.content();
      const scripts = await page.$$eval('script', (scripts: any) => scripts.map((s: any) => s.textContent).join('\n'));
      content = html + '\n' + scripts;
    }
    const regex = new RegExp(regexPattern, regexFlags);
    const matches = content.match(regex) || [];
    const finalMatches = autoDecode ? matches.map((m: string) => {
      try { return decodeURIComponent(m); } catch { return m; }
    }) : matches;
    return { pattern: regexPattern, flags: regexFlags, matchCount: finalMatches.length, matches: finalMatches.slice(0, maxMatches) };
  };

  const extractJson = async (jsonSource: any, sel?: any, path?: any) => {
    const jsonData: any[] = [];
    if (jsonSource === 'ld+json') {
      const ldJson = await page.$$eval('script[type="application/ld+json"]', (scripts: any) =>
        scripts.map((s: any) => { try { return JSON.parse(s.textContent); } catch { return null; } }).filter(Boolean));
      jsonData.push(...ldJson);
    } else if (jsonSource === 'scripts') {
      const content = await page.$$eval('script', (scripts: any) => scripts.map((s: any) => s.textContent).join('\n'));
      const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]/g;
      const matches = content.match(jsonRegex) || [];
      for (const match of matches.slice(0, maxJsonObjects)) { try { jsonData.push(JSON.parse(match)); } catch { } }
    } else if (jsonSource === 'api') {
      const apiData = await page.evaluate(() => {
        const data: any[] = [];
        if (window.__DATA__) data.push(window.__DATA__);
        if (window.__INITIAL_STATE__) data.push(window.__INITIAL_STATE__);
        if (window.__APP_DATA__) data.push(window.__APP_DATA__);
        if (window.data) data.push(window.data);
        if (window.config) data.push(window.config);
        return data;
      });
      jsonData.push(...apiData);
    } else if (sel) {
      try { const text = await page.$eval(sel, (el: any) => el.textContent); jsonData.push(JSON.parse(text)); } catch { }
    } else {
      const ldJson = await page.$$eval('script[type="application/ld+json"]', (scripts: any) =>
        scripts.map((s: any) => { try { return JSON.parse(s.textContent); } catch { return null; } }).filter(Boolean));
      jsonData.push(...ldJson);
    }
    if (path && jsonData.length > 0) {
      const getPath = (obj: any, pathStr: any) => {
        const parts = pathStr.replace(/^\$\./, '').split('.');
        let current = obj;
        for (const part of parts) {
          if (current === null || current === undefined) return undefined;
          if (part.includes('[') && part.includes(']')) {
            const arrName = part.substring(0, part.indexOf('['));
            const idx = parseInt(part.match(/\[(\d+)\]/)?.[1] || '0');
            current = current[arrName]?.[idx];
          } else current = current[part];
        }
        return current;
      };
      return jsonData.map(obj => ({ original: obj, extracted: getPath(obj, path) }));
    }
    return jsonData;
  };

  const extractMeta = async (metaTypes: any) => {
    const meta = await page.evaluate(([incTitle, incCanonical]: any) => {
      const result: any = { meta: {}, og: {}, twitter: {} };
      document.querySelectorAll('meta').forEach(tag => {
        const name = tag.getAttribute('name') || tag.getAttribute('property');
        const content = tag.getAttribute('content');
        if (name && content) {
          if (name.startsWith('og:')) result.og[name.replace('og:', '')] = content;
          else if (name.startsWith('twitter:')) result.twitter[name.replace('twitter:', '')] = content;
          else result.meta[name] = content;
        }
      });
      if (incTitle) result.title = document.title;
      if (incCanonical) result.canonical = document.querySelector('link[rel="canonical"]')?.href;
      return result;
    }, [includeTitle, includeCanonical]);
    if (metaTypes.includes('all')) return meta;
    const filtered: any = {};
    if (metaTypes.includes('meta')) filtered.meta = meta.meta;
    if (metaTypes.includes('og')) filtered.og = meta.og;
    if (metaTypes.includes('twitter')) filtered.twitter = meta.twitter;
    if (includeTitle) filtered.title = meta.title;
    if (includeCanonical) filtered.canonical = meta.canonical;
    return filtered;
  };

  const extractStructured = async (sel: any, wait = false, timeout = 10000) => {
    if (wait) await page.waitForSelector(sel, { timeout });
    const element = await page.$(sel);
    if (!element) return { error: `Element not found: ${sel}` };
    return element.evaluate((el: any) => ({
      tagName: el.tagName, text: el.innerText, html: el.innerHTML,
      attributes: Object.fromEntries([...el.attributes].map((a: any) => [a.name, a.value])),
      childCount: el.children.length,
      boundingBox: el.getBoundingClientRect ? {
        x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
        width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height
      } : null
    }));
  };

  const extractAuto = async () => {
    const autoResults: any = { meta: null, json: null, structured: null, patterns: [] };
    try { autoResults.meta = await extractMeta(['all']); } catch (e) { }
    try { autoResults.json = await extractJson('ld+json'); } catch (e) { }
    const commonPatterns = [
      { name: 'emails', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' },
      { name: 'phones', pattern: '(\\+?1?[-.\\s]?)?\\(?[0-9]{3}\\)?[-.\\s]?[0-9]{3}[-.\\s]?[0-9]{4}' },
      { name: 'urls', pattern: 'https?://[^\\s<>"{}|\\\\^`\\[\\]]+' },
      { name: 'ipv4', pattern: '\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b' }
    ];
    const pageText = await page.evaluate(() => document.body.innerText);
    for (const { name, pattern } of commonPatterns) {
      const regex = new RegExp(pattern, 'gi');
      const matches = [...new Set(pageText.match(regex) || [])];
      if (matches.length > 0) autoResults.patterns.push({ type: name, count: matches.length, samples: matches.slice(0, 10) });
    }
    return autoResults;
  };

  const extractLinks = async () => {
    const { includeHidden = true, searchIframes = false } = params;
    const doExtract = async (context: any) => {
      return await context.evaluate(({ incHidden }: any) => {
        const allLinks: any[] = [];
        const seenUrls = new Set();
        const addLink = (href: any, text: any, source: any, element: any) => {
          if (!href || seenUrls.has(href)) return;
          if (!href.startsWith('http') && !href.startsWith('//')) return;
          if (href.startsWith('//')) href = window.location.protocol + href;
          seenUrls.add(href);
          allLinks.push({
            href, text: (text || '').trim().substring(0, 100), source,
            hidden: element ? (element.offsetParent === null || getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden') : false
          });
        };
        document.querySelectorAll('a[href]').forEach(a => addLink(a.href, a.textContent, 'anchor', a));
        ['data-href', 'data-url', 'data-link', 'data-src', 'data-file', 'data-download'].forEach(attr =>
          document.querySelectorAll(`[${attr}]`).forEach(el => addLink(el.getAttribute(attr), el.textContent, attr, el)));
        if (incHidden) {
          document.querySelectorAll('[onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick');
            if (!onclick) return;
            (onclick.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(url => addLink(url, el.textContent, 'onclick', el));
            const hrefMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (hrefMatch) addLink(hrefMatch[1], el.textContent, 'onclick-location', el);
            const openMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
            if (openMatch) addLink(openMatch[1], el.textContent, 'onclick-window-open', el);
          });
          [...document.querySelectorAll('script')].slice(0, 20).forEach(script => {
            const content = script.textContent || '';
            [/["']?(https?:\/\/[^"'\s<>]+\.(mp4|mkv|avi|m3u8|mpd|zip|rar|pdf))[^"'\s<>]*["']?/gi,
             /download[_-]?url\s*[:=]\s*["']([^"']+)["']/gi,
             /file\s*[:=]\s*["']([^"']+)["']/gi].forEach(pattern => {
              let match;
              while ((match = pattern.exec(content)) !== null) addLink(match[1], 'script-extracted', 'script', null);
            });
          });
        }
        document.querySelectorAll('a[href^="javascript:"]').forEach(a => {
          const match = a.getAttribute('href')?.match(/https?:\/\/[^\s"'<>]+/gi);
          if (match) match.forEach(url => addLink(url, a.textContent, 'javascript-href', a));
        });
        document.querySelectorAll('input[type="hidden"]').forEach((input: any) => {
          if (input.value && (input.value.startsWith('http') || input.value.startsWith('//'))) addLink(input.value, input.name || input.id, 'hidden-input', input);
        });
        const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
        if (metaRefresh) {
          const match = metaRefresh.getAttribute('content')?.match(/url=(.+)/i);
          if (match) addLink(match[1].trim().replace(/['"]/g, ''), 'meta-refresh', 'meta', null);
        }
        document.querySelectorAll('iframe[src]').forEach((iframe: any) => addLink(iframe.src, 'iframe', 'iframe', iframe));
        return allLinks;
      }, { incHidden: includeHidden }).catch(() => []);
    };
    let links = await doExtract(page);
    if (searchIframes) {
      const frames = page.frames();
      for (let i = 1; i < frames.length && i < 5; i++) {
        try {
          const frame = frames[i];
          if (frame.url() && frame.url() !== 'about:blank') {
            const frameLinks = await doExtract(frame);
            frameLinks.forEach((link: any) => link.source = `iframe:${link.source}`);
            links = [...links, ...frameLinks];
          }
        } catch (e) { }
      }
    }
    if (!includeHidden) links = links.filter((link: any) => !link.hidden);
    const seen = new Set();
    return links.filter((link: any) => { if (seen.has(link.href)) return false; seen.add(link.href); return true; });
  };

  switch (type) {
    case 'links': {
      const links = await extractLinks();
      results.extracted = { count: links.length, links };
      notifyProgress('extract_data', 'completed', `Links: ${links.length} extracted`);
      break;
    }
    case 'regex': {
      if (!pattern) return { success: false, error: 'Pattern is required for regex extraction' };
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
        if (typeof val === 'object' && val !== null) return sum + Object.keys(val).length;
        return sum + (val ? 1 : 0);
      }, 0);
      notifyProgress('extract_data', 'completed', `Meta: ${tagCount} tags`);
      break;
    }
    case 'structured': {
      if (!selector) return { success: false, error: 'Selector is required for structured extraction. Run see_page(annotate: true) first to discover valid selectors or annotation IDs.' };
      results.extracted = await extractStructured(selector, waitForSelector, selectorTimeout);
      if (results.extracted.error) { results.success = false; results.error = results.extracted.error; delete results.extracted; }
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
      results.extracted = await deobfuscateJS(page);
      notifyProgress('extract_data', 'completed', `Deobfuscated: ${results.extracted.decodedStrings.length} strings`);
      break;
    }
    case 'apiDiscovery': {
      results.extracted = await discoverAPIs(page);
      const total = results.extracted.fetchEndpoints.length + results.extracted.xhrEndpoints.length +
        results.extracted.inlineApiPatterns.length + results.extracted.dynamicApis.length;
      notifyProgress('extract_data', 'completed', `API Discovery: ${total} endpoints found`);
      break;
    }
    case 'decrypt': {
      results.extracted = await decryptData(page, params);
      const decodedCount = results.extracted.decoded.length + (results.extracted.aesDecrypted ? 1 : 0);
      notifyProgress('extract_data', 'completed', `Decrypted: ${decodedCount} decodings`);
      break;
    }
    default:
      return { success: false, error: `Unknown type: ${type}. Supported: regex, json, meta, structured, auto, deobfuscate, apiDiscovery, decrypt, links` };
  }

  return results;
}

async function deobfuscateJS(page: any) {
  const scriptContents = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script')).map((s: any) => s.textContent).join('\n')
  ).catch(() => '');
  const externalScripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map((s: any) => s.src)
  ).catch(() => []);

  let allJs = scriptContents;
  for (const src of externalScripts.slice(0, 10)) {
    try { const resp = await fetch(src); allJs += '\n' + await resp.text(); } catch (e) { }
  }

  const deobfuscated: any = {
    stringArrays: [], decodedStrings: [], functionMappings: [],
    apiEndpoints: [], urls: [], fetchCalls: [],
    webpackModules: [], evalUnpacked: [], resolvedConcats: [], unicodeDecoded: []
  };

  const arrayPattern = /(?:const|var|let)\s+(_0x[a-f0-9]+)\s*=\s*\[([^\]]{20,})\]/g;
  let match;
  while ((match = arrayPattern.exec(allJs)) !== null) {
    try {
      const items = match[2].match(/'([^']*)'|"([^"]*)"/g) || [];
      const decoded = items.map(s => s.replace(/^['"]|['"]$/g, ''));
      deobfuscated.stringArrays.push({ variable: match[1], count: decoded.length, strings: decoded });
      deobfuscated.decodedStrings.push(...decoded);
    } catch (e) { }
  }

  const hexStrings = [...new Set((allJs.match(/(?:'(?:\\x[0-9a-f]{2})+[^']*'|"(?:\\x[0-9a-f]{2})+[^"]*")/gi) || []))] as string[];
  for (const hs of hexStrings.slice(0, 50)) {
    try {
      const decoded = hs.slice(1, -1).replace(/\\x([0-9a-f]{2})/gi, (_: any, h: any) => String.fromCharCode(parseInt(h, 16)));
      if (decoded.length > 2) deobfuscated.decodedStrings.push(decoded);
    } catch (e) { }
  }

  const unicodePattern = /(?:'(?:\\u[0-9a-f]{4})+[^']*'|"(?:\\u[0-9a-f]{4})+[^"]*")/gi;
  const unicodeMatches = allJs.match(unicodePattern) || [];
  for (const um of unicodeMatches.slice(0, 50)) {
    try {
      const decoded = um.slice(1, -1).replace(/\\u([0-9a-f]{4})/gi, (_: any, h: any) => String.fromCharCode(parseInt(h, 16)));
      if (decoded.length > 1) { deobfuscated.unicodeDecoded.push(decoded); deobfuscated.decodedStrings.push(decoded); }
    } catch (e) { }
  }

  const evalPattern = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,?\s*[dr]?\s*\)\s*\{[^}]*\}\s*\(\s*'([^']*)'(?:\s*,\s*(\d+)){2}\s*,\s*'([^']*)'/g;
  let evalMatch;
  while ((evalMatch = evalPattern.exec(allJs)) !== null) {
    try {
      const p = evalMatch[1], a = parseInt(evalMatch[2]) || 62;
      const keywords = evalMatch[3].split('|');
      const unpacked = p.replace(/\b\w+\b/g, (w: any) => { const n = parseInt(w, a); return (n < keywords.length && keywords[n]) ? keywords[n] : w; });
      deobfuscated.evalUnpacked.push(unpacked.substring(0, 3000));
      const unpackedStrings = unpacked.match(/['"]([^'"]{3,})['"]/g) || [];
      for (const s of unpackedStrings.slice(0, 100)) deobfuscated.decodedStrings.push(s.replace(/^['"]|['"]$/g, ''));
    } catch (e) { }
  }
  const simpleEval = /eval\s*\(\s*['"]([^'"]{10,})['"]\s*\)/g;
  let seMatch;
  while ((seMatch = simpleEval.exec(allJs)) !== null) deobfuscated.evalUnpacked.push(seMatch[1].substring(0, 2000));

  const webpackExports = allJs.match(/(?:module\.exports|exports\.\w+)\s*=\s*['"]([^'"]+)['"]/g) || [];
  for (const exp of webpackExports.slice(0, 30)) {
    const val = exp.match(/=\s*['"]([^'"]+)['"]/);
    if (val) { deobfuscated.webpackModules.push(val[1]); deobfuscated.decodedStrings.push(val[1]); }
  }
  const chunkIds = allJs.match(/webpackChunk\w*\.push\s*\(\s*\[\s*\[([^\]]+)\]/g) || [];
  for (const ci of chunkIds.slice(0, 10)) deobfuscated.webpackModules.push(`chunk: ${ci.substring(0, 100)}`);

  const terserPattern = /(?:var|let|const)\s+([a-z])\s*=\s*['"]([^'"]{2,})['"]/gi;
  let terserMatch;
  while ((terserMatch = terserPattern.exec(allJs)) !== null) {
    const varName = terserMatch[1], value = terserMatch[2];
    if (value.length > 2 && value.length < 200) {
      deobfuscated.functionMappings.push({ variable: varName, value });
      deobfuscated.decodedStrings.push(value);
    }
  }

  const concatPattern = /(?:['"][^'"]*['"]\s*\+\s*){2,}['"][^'"]*['"]/g;
  const concatMatches = allJs.match(concatPattern) || [];
  for (const cm of concatMatches.slice(0, 50)) {
    try {
      const parts = cm.match(/['"]([^'"]*)['"]|(['"])/g) || [];
      const resolved = parts.map((p: any) => p.replace(/^['"]|['"]$/g, '')).join('');
      if (resolved.length > 3) { deobfuscated.resolvedConcats.push(resolved); deobfuscated.decodedStrings.push(resolved); }
    } catch (e) { }
  }

  const fetchPatterns = allJs.match(/fetch\s*\(\s*['"]([^'"]+)['"]/g) || [];
  deobfuscated.fetchCalls = fetchPatterns.map((f: any) => f.replace(/fetch\s*\(\s*['"]/, '').replace(/['"]$/, '')).slice(0, 20);

  deobfuscated.urls = [...new Set(deobfuscated.decodedStrings.filter((s: any) =>
    s.match(/^(https?:\/\/|\/)/) || s.match(/\.(php|json|api|asp|jsp)$/i)
  ))].slice(0, 50);
  deobfuscated.apiEndpoints = [...new Set(deobfuscated.decodedStrings.filter((s: any) =>
    s.match(/^\/[a-z]/i) && s.length > 3 && s.length < 100
  ))].slice(0, 30);
  deobfuscated.decodedStrings = [...new Set(deobfuscated.decodedStrings)].slice(0, 500);

  return deobfuscated;
}

async function discoverAPIs(page: any) {
  const apiResults: any = {
    fetchEndpoints: [], xhrEndpoints: [], formActions: [],
    scriptSources: [], inlineApiPatterns: [], postBodies: [], dynamicApis: []
  };

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
            found.push({ type: 'fetch', url, method: opts.method || 'GET', body: typeof opts.body === 'string' ? opts.body.substring(0, 500) : null });
          } catch (e) { }
          return origFetch.apply(this, args as any);
        };
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) { (this as any).__apiUrl = url; (this as any).__apiMethod = method; return origOpen.apply(this, [method, url, ...rest] as any); };
        XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
          found.push({ type: 'xhr', url: (this as any).__apiUrl, method: (this as any).__apiMethod, body: typeof body === 'string' ? body.substring(0, 500) : null });
          return origSend.apply(this, [body]);
        };
        (window as any).__capturedApis = found;
        setTimeout(() => resolve(found), 3000);
      });
    });
    apiResults.dynamicApis = runtimeApis as any;
  } catch (e) { apiResults.dynamicApis = []; }

  const allScriptContent = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script')).map((s: any) => s.textContent).join('\n')
  ).catch(() => '');

  const fetchRegex = /fetch\s*\(\s*(?:['"`]([^'"`]+)['"`]|([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
  let fMatch;
  while ((fMatch = fetchRegex.exec(allScriptContent)) !== null) apiResults.fetchEndpoints.push((fMatch[1] || fMatch[2]) as never);
  apiResults.fetchEndpoints = [...new Set(apiResults.fetchEndpoints)].slice(0, 30);

  const xhrRegex = /\.open\s*\(\s*['"](?:GET|POST|PUT|DELETE)['"]\s*,\s*['"`]([^'"`]+)['"`]/gi;
  let xMatch;
  while ((xMatch = xhrRegex.exec(allScriptContent)) !== null) apiResults.xhrEndpoints.push(xMatch[1] as never);
  apiResults.xhrEndpoints = [...new Set(apiResults.xhrEndpoints)].slice(0, 30);

  apiResults.formActions = await page.evaluate(() =>
    Array.from(document.querySelectorAll('form[action]')).map((f: any) => ({ action: f.action, method: f.method || 'GET', id: f.id || null }))
  ).catch(() => []);

  const postBodyPatterns = allScriptContent.match(/(?:URLSearchParams|FormData|JSON\.stringify)\s*\(\s*\{[^}]{5,200}\}/g) || [];
  apiResults.postBodies = postBodyPatterns.slice(0, 10);

  const apiUrlPattern = /['"`]((?:https?:\/\/[^'"`]+|\/)(?:[a-zA-Z0-9_\-\/]+\.(?:php|json|api|asp|aspx|do|action))[^'"`]*)['"`]/g;
  let apiMatch;
  while ((apiMatch = apiUrlPattern.exec(allScriptContent)) !== null) apiResults.inlineApiPatterns.push(apiMatch[1]);
  apiResults.inlineApiPatterns = [...new Set(apiResults.inlineApiPatterns)].slice(0, 30);

  apiResults.scriptSources = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map((s: any) => s.src)
  ).catch(() => []);

  return apiResults;
}

async function decryptData(page: any, params: any) {
  const { encryptedData, autoFindKey = true } = params;
  const decryptResults: any = { original: null, decoded: [], detectedEncoding: [], extractedKeys: [], aesDecrypted: null };

  let dataToDecrypt = encryptedData;
  if (!dataToDecrypt) {
    const { state } = require('./state');
    const lastApiResponse = state.networkRecords.filter((r: any) => r.responseBody).pop();
    if (lastApiResponse) dataToDecrypt = lastApiResponse.responseBody;
  }
  if (!dataToDecrypt) return { success: false, error: 'No data to decrypt. Provide encryptedData parameter or start network_recorder first.' };
  decryptResults.original = dataToDecrypt.substring(0, 500);

  let b64Data = dataToDecrypt.trim();
  for (let level = 0; level < 5; level++) {
    if (!/^[A-Za-z0-9+/=]+$/.test(b64Data) || b64Data.length < 4) break;
    try {
      const decoded = Buffer.from(b64Data, 'base64').toString('utf-8');
      if (decoded && decoded.length > 0 && !/[\x00-\x08\x0e-\x1f]/.test(decoded.substring(0, 100))) {
        decryptResults.decoded.push({ level: level + 1, type: 'base64', value: decoded.substring(0, 5000) });
        decryptResults.detectedEncoding.push('base64');
        try { decryptResults.decoded.push({ level: level + 1, type: 'base64_json', value: JSON.parse(decoded) }); } catch (e) { }
        b64Data = decoded;
      } else break;
    } catch (e) { break; }
  }

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

  if (dataToDecrypt.includes('%')) {
    try {
      let urlDecoded = decodeURIComponent(dataToDecrypt);
      decryptResults.decoded.push({ type: 'url', value: urlDecoded.substring(0, 5000) });
      decryptResults.detectedEncoding.push('url');
      if (urlDecoded.includes('%')) {
        urlDecoded = decodeURIComponent(urlDecoded);
        decryptResults.decoded.push({ type: 'url_double', value: urlDecoded.substring(0, 5000) });
      }
    } catch (e) { }
  }

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

  if (autoFindKey) {
    try {
      const keys = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script')).map((s: any) => s.textContent).join('\n');
        const found: any[] = [];
        const cryptoPatterns = [
          /CryptoJS\.AES\.decrypt\s*\(\s*\w+\s*,\s*['"]([^'"]+)['"]/g,
          /CryptoJS\.AES\.encrypt\s*\(\s*\w+\s*,\s*['"]([^'"]+)['"]/g,
          /CryptoJS\.enc\.Utf8\.parse\s*\(\s*['"]([^'"]+)['"]/g,
          /(?:secret|key|pass|password|iv|salt)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
          /aes(?:Key|_key|Secret)\s*[:=]\s*['"]([^'"]{8,})['"]/gi
        ];
        for (const pat of cryptoPatterns) { let m; while ((m = pat.exec(scripts)) !== null) found.push({ pattern: pat.source.substring(0, 50), key: m[1] }); }
        return found;
      });
      decryptResults.extractedKeys = keys.slice(0, 20);
    } catch (e) { }
  }

  const aesKey = params.aesKey || (decryptResults.extractedKeys[0]?.key);
  if (aesKey && dataToDecrypt.length > 10) {
    try {
      const crypto = require('crypto');
      for (const keyEncoding of ['utf8', 'hex', 'base64']) {
        try {
          let keyBuf;
          if (keyEncoding === 'utf8') { keyBuf = Buffer.alloc(32); const kb = Buffer.from(aesKey as string, 'utf8'); kb.copy(keyBuf); }
          else keyBuf = Buffer.from(aesKey as string, keyEncoding as BufferEncoding);
          const dataBuf = Buffer.from(dataToDecrypt as string, 'base64');
          if (dataBuf.length > 16) {
            const iv = params.aesIV ? Buffer.from(params.aesIV as string, keyEncoding as BufferEncoding) : dataBuf.slice(0, 16);
            const encrypted = params.aesIV ? dataBuf : dataBuf.slice(16);
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
            decipher.setAutoPadding(true);
            let decrypted = decipher.update(encrypted, undefined, 'utf8');
            decrypted += decipher.final('utf8');
            if (decrypted && decrypted.length > 0) {
              decryptResults.aesDecrypted = decrypted.substring(0, 5000);
              decryptResults.detectedEncoding.push('aes-256-cbc');
              try { decryptResults.aesDecrypted = JSON.parse(decrypted); } catch (e) { }
              break;
            }
          }
        } catch (e) { continue; }
      }
    } catch (e) { }
  }

  return decryptResults;
}

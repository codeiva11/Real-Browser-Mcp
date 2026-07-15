
import { requireBrowser, notifyProgress } from './state';
import {
  startRecording, stopRecording, clearRecording,
  getMediaRecords, getNavigationRecords, getApiCallRecords,
  getInterceptedApis, getWebSocketRecords, getGraphQLRecords,
  exportHAR, getFilteredRecords
} from './network-recorder';
import { extractData } from './network-extractors';
import type { RedirectTracerParams, NetworkRecorderParams } from '../../types';

export const networkHandlers = {
  async redirect_tracer(params: RedirectTracerParams) {
    const { page } = requireBrowser();
    const { url, maxRedirects = 20, includeHeaders = false, followJS = true, followMeta = true, decodeURLs = true, timeout = 30000 } = params;

    notifyProgress('redirect_tracer', 'started', `Tracing redirects for: ${url}`);

    const redirects: any[] = [];
    const jsNavigations: any[] = [];
    let currentUrl = url;

    const responseHandler = (response: any) => {
      if ([301, 302, 303, 307, 308].includes(response.status())) {
        if (redirects.length < maxRedirects) {
          redirects.push({ url: response.url(), status: response.status(), type: 'http', headers: includeHeaders ? response.headers() : undefined });
          notifyProgress('redirect_tracer', 'progress', `HTTP Redirect ${redirects.length}: ${response.status()}`, { status: response.status() });
        }
      }
    };

    const frameNavigatedHandler = (frame: any) => {
      if (frame === page.mainFrame()) {
        const newUrl = frame.url();
        if (newUrl !== currentUrl && newUrl !== 'about:blank') {
          jsNavigations.push({ url: newUrl, type: 'js_navigation', fromUrl: currentUrl, timestamp: Date.now() });
          notifyProgress('redirect_tracer', 'progress', `JS Navigation: ${newUrl}`, { type: 'js' });
          currentUrl = newUrl;
        }
      }
    };

    page.on('response', responseHandler);
    page.on('framenavigated', frameNavigatedHandler);

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout });
      if (followMeta) {
        const metaRefresh = await page.evaluate(() => {
          const meta = document.querySelector('meta[http-equiv="refresh"]');
          if (meta) { const content = meta.getAttribute('content'); const match = content?.match(/url=(.+)/i); return match ? match[1].trim().replace(/['"]/g, '') : null; }
          return null;
        }).catch(() => null);
        if (metaRefresh) jsNavigations.push({ url: metaRefresh, type: 'meta_refresh', fromUrl: page.url() });
      }
      if (followJS) {
        const jsLinks = await page.evaluate(() => {
          const links: any[] = [];
          document.querySelectorAll('a[href^="javascript:"], [onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick');
            const href = el.getAttribute('href');
            if (onclick) { const match = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/); if (match) links.push({ url: match[1], type: 'onclick' }); }
            if (href && href.includes('location')) links.push({ url: href, type: 'javascript_href' });
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

    let allRedirects = [...redirects, ...jsNavigations.filter(nav => nav.url && nav.url.startsWith('http'))];

    if (decodeURLs) {
      allRedirects = allRedirects.map(r => {
        try {
          const decoded = decodeURIComponent(r.url);
          if (decoded !== r.url) return { ...r, url: r.url, decodedUrl: decoded };
        } catch {}
        return r;
      });
    }

    notifyProgress('redirect_tracer', 'completed', `Found ${redirects.length} HTTP + ${jsNavigations.length} JS redirects`, { httpRedirects: redirects.length, jsNavigations: jsNavigations.length, finalUrl: page.url() });

    return { success: true, originalUrl: url, finalUrl: page.url(), redirectCount: allRedirects.length, httpRedirects: redirects, jsNavigations, allRedirects };
  },

  async network_recorder(params: NetworkRecorderParams = {}) {
    const { page } = requireBrowser();
    const { action = 'get', filter = {}, captureXhrBody = false } = params;

    switch (action) {
      case 'start': return startRecording(page, captureXhrBody).then(() => ({ success: true, message: 'Recording started', captureXhrBody }));
      case 'stop': stopRecording(); return { success: true };
      case 'clear': await clearRecording(page); return { success: true };
      case 'get_media': return getMediaRecords();
      case 'get_navigations': return getNavigationRecords();
      case 'get_api_calls': return getApiCallRecords();
      case 'get_intercepted_apis': return await getInterceptedApis(page);
      case 'get_websockets': return await getWebSocketRecords(page);
      case 'get_graphql': return getGraphQLRecords();
      case 'export_har': return exportHAR();
    }

    return getFilteredRecords(filter);
  },

  async extract_data(params: any = {}) {
    return extractData(params);
  },

  async replay_request(params: any) {
    const { page } = requireBrowser();
    const { url, method = 'GET', headers, body } = params;
    notifyProgress('replay_request', 'started', `Replaying ${method} to ${url}`);
    try {
      const result = await page.evaluate(async ({ u, m, h, b }: any) => {
        const res = await fetch(u, { method: m, headers: h, body: b });
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text().catch(() => null) };
      }, { u: url, m: method, h: headers || {}, b: body });
      notifyProgress('replay_request', 'completed', `Replay finished with status ${result.status}`);
      return { success: true, result };
    } catch (e: any) {
      notifyProgress('replay_request', 'error', `Replay failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
};


import { state, requireBrowser, notifyProgress } from './state';
import {
  startRecording, stopRecording, clearRecording,
  getMediaRecords, getNavigationRecords, getApiCallRecords,
  getInterceptedApis, getWebSocketRecords, getGraphQLRecords,
  exportHAR, getFilteredRecords
} from './network-recorder';
import { extractData } from './network-extractors';
import { assertSafeUrl } from '../../shared/url-utils';
import { globToUrlPredicate } from './advanced';
import type { RedirectTracerParams, NetworkRecorderParams } from '../../types';

export const networkHandlers = {
  async redirect_tracer(params: RedirectTracerParams) {
    const { browser, page: originalPage } = requireBrowser();
    const { url, maxRedirects = 20, includeHeaders = false, followJS = true, followMeta = true, decodeURLs = true, timeout = 30000 } = params;

    await assertSafeUrl(url, 'redirect_tracer');

    notifyProgress('redirect_tracer', 'started', `Tracing redirects for: ${url}`);

    // Trace on a dedicated scratch page so the user's current page state is
    // preserved — this tool performs a real navigation. New pages in the same
    // context automatically get UA override, blocking, and popup protection.
    // NOTE: opening any page fires the context 'page' listener registered in
    // browser_init, which repoints state.pageInstance at the newest page.
    // We restore the original page below so later tools keep working.
    const context = browser.contexts()[0];
    const tracePage = await context.newPage();
    if (state.setupPageFn) {
      try { await state.setupPageFn(tracePage); } catch { /* scratch page setup is best-effort */ }
    }

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
      if (frame === tracePage.mainFrame()) {
        const newUrl = frame.url();
        if (newUrl !== currentUrl && newUrl !== 'about:blank') {
          jsNavigations.push({ url: newUrl, type: 'js_navigation', fromUrl: currentUrl, timestamp: Date.now() });
          notifyProgress('redirect_tracer', 'progress', `JS Navigation: ${newUrl}`, { type: 'js' });
          currentUrl = newUrl;
        }
      }
    };

    tracePage.on('response', responseHandler);
    tracePage.on('framenavigated', frameNavigatedHandler);

    try {
      await tracePage.goto(url, { waitUntil: 'networkidle', timeout });
      if (followMeta) {
        const metaRefresh = await tracePage.evaluate(() => {
          const meta = document.querySelector('meta[http-equiv="refresh"]');
          if (meta) { const content = meta.getAttribute('content'); const match = content?.match(/url=(.+)/i); return match ? match[1].trim().replace(/['"]/g, '') : null; }
          return null;
        }).catch(() => null);
        if (metaRefresh) jsNavigations.push({ url: metaRefresh, type: 'meta_refresh', fromUrl: tracePage.url() });
      }
      if (followJS) {
        const jsLinks = await tracePage.evaluate(() => {
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

    tracePage.off('response', responseHandler);
    tracePage.off('framenavigated', frameNavigatedHandler);
    const finalUrl = tracePage.url();
    try { await tracePage.close(); } catch { /* already closed */ }

    // Restore the user's original page: the context 'page' listener hijacked
    // state.pageInstance when we opened the scratch tracePage (now closed).
    try {
      if (originalPage && !(originalPage as any).isClosed()) {
        state.pageInstance = originalPage;
      }
    } catch { /* keep current state on restore failure */ }

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

    notifyProgress('redirect_tracer', 'completed', `Found ${redirects.length} HTTP + ${jsNavigations.length} JS redirects`, { httpRedirects: redirects.length, jsNavigations: jsNavigations.length, finalUrl });

    return { success: true, originalUrl: url, finalUrl, redirectCount: allRedirects.length, httpRedirects: redirects, jsNavigations, allRedirects };
  },

  async network_recorder(params: NetworkRecorderParams = {}) {
    const { page } = requireBrowser();
    const { action = 'get', filter = {}, captureXhrBody = false, patterns, mock } = params;

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

      case 'block_urls': {
        const targetPatterns = (Array.isArray(patterns) && patterns.length > 0)
          ? patterns
          : ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.svg', '**/*.woff*', '*google-analytics*', '*doubleclick*', '*facebook.net*'];

        for (const pat of targetPatterns) {
          try {
            // Predicate matcher: native glob quirk (leading `*` never matches
            // scheme+host) would silently skip patterns like `*analytics*`.
            // Context-level routes (not page-level) for robustness.
            const matchUrl = globToUrlPredicate(pat);
            await page.context().route((url: any) => { try { return matchUrl(url.toString()); } catch { return false; } },
              (route: any) => route.abort());
          } catch { /* ignore route errors */ }
        }
        notifyProgress('network_recorder', 'completed', `Blocked ${targetPatterns.length} URL patterns`);
        return { success: true, action: 'block_urls', blockedPatterns: targetPatterns };
      }

      case 'mock_route': {
        if (!mock?.urlPattern) {
          throw new Error('mock.urlPattern is required for mock_route');
        }
        const status = mock.status ?? 200;
        const contentType = mock.contentType ?? 'application/json';
        const body = mock.body ?? '{}';

        await page.route(mock.urlPattern, (route: any) => {
          route.fulfill({
            status,
            contentType,
            body
          });
        });
        notifyProgress('network_recorder', 'completed', `Mock route set for: ${mock.urlPattern}`);
        return { success: true, action: 'mock_route', urlPattern: mock.urlPattern, status, contentType };
      }

      case 'clear_routes': {
        try {
          if (typeof (page as any).unrouteAll === 'function') {
            await (page as any).unrouteAll({ behavior: 'ignoreErrors' });
          } else {
            await page.unroute('**/*');
          }
        } catch { /* ignore */ }
        notifyProgress('network_recorder', 'completed', 'Cleared all network route intercepts');
        return { success: true, action: 'clear_routes' };
      }
      // NOTE: rewrite_headers action was removed — header modification via
      // route.continue({headers}) works in isolation but is silently dropped
      // in the full server environment (lib-core page setup interaction).
      // Use replay_request with custom headers instead.
    }

    return getFilteredRecords(filter);
  },

  async extract_data(params: any = {}) {
    return extractData(params);
  }
};

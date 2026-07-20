import { state, requireBrowser, notifyProgress, detachNetworkRecorderListeners } from './state';

export async function startRecording(page: any, captureXhrBody = false) {
  detachNetworkRecorderListeners();
  state.networkRecords = [];
  state.isRecordingNetwork = true;

  try {
    await page.addInitScript(() => {
      window.__interceptedApis = [];
      window.__wsMessages = [];

      const origFetch = window.fetch;
      window.fetch = function (...args: any[]) {
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || String(args[0]));
          const opts = args[1] || {};
          window.__interceptedApis.push({
            type: 'fetch', url, method: opts.method || 'GET',
            headers: opts.headers ? JSON.parse(JSON.stringify(opts.headers)) : null,
            body: typeof opts.body === 'string' ? opts.body.substring(0, 2000) : null,
            timestamp: Date.now()
          });
        } catch (e) { }
        return origFetch.apply(this, args as any);
      };

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
      (window.WebSocket as any).prototype = OrigWS.prototype;
      (window.WebSocket as any).CONNECTING = OrigWS.CONNECTING;
      (window.WebSocket as any).OPEN = OrigWS.OPEN;
      (window.WebSocket as any).CLOSING = OrigWS.CLOSING;
      (window.WebSocket as any).CLOSED = OrigWS.CLOSED;
    });
  } catch (e) { }

  const requestListener = (req: any) => {
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
  };

  const responseListener = async (res: any) => {
    if (state.isRecordingNetwork) {
      const url = res.url();
      const contentType = res.headers()['content-type'] || '';
      const isMedia = contentType.includes('video') ||
        contentType.includes('audio') ||
        contentType.includes('mpegurl') ||
        url.includes('.m3u8') || url.includes('.mpd') || url.includes('.mp4') || url.includes('.ts');

      const isApiCall = contentType.includes('json') ||
        contentType.includes('x-www-form-urlencoded') ||
        url.match(/\.(php|api|json|do|action)($|\?)/) ||
        (res.request().resourceType() === 'xhr') ||
        (res.request().resourceType() === 'fetch');

      const isBinaryBody = isMedia ||
        contentType.includes('octet-stream') || contentType.includes('application/pdf') ||
        contentType.includes('image/') || contentType.includes('font/') ||
        contentType.includes('zip') || contentType.includes('rar');

      const record: any = {
        type: 'response', url, method: res.request().method(), status: res.status(),
        headers: res.headers(), contentType, isMedia, isApiCall, resourceType: res.request().resourceType(), timestamp: Date.now()
      };

      if (isMedia) {
        record.mediaType = url.includes('.m3u8') ? 'hls' : url.includes('.mpd') ? 'dash' : url.includes('.mp4') ? 'mp4' : 'other';
      }

      if (isApiCall) {
        try {
          const postData = res.request().postData();
          if (postData) record.requestBody = postData.substring(0, 2000);
          if (isBinaryBody) {
            record.responseBody = `[binary/media body omitted: ${contentType || 'unknown content-type'}]`;
          } else if (captureXhrBody) {
            // Only capture response bodies when explicitly requested (saves memory)
            const responseBody = await res.text().catch(() => null);
            if (responseBody) {
              record.responseBody = responseBody.substring(0, 5000);
              record.responseTruncated = responseBody.length > 5000;
              try { record.responseJson = JSON.parse(responseBody); } catch (e) { }
            }
          }
        } catch (e) { }
      }

      state.networkRecords.push(record);
    }
  };

  const navigationListener = (frame: any) => {
    if (state.isRecordingNetwork && frame === page.mainFrame()) {
      state.networkRecords.push({ type: 'navigation', url: frame.url(), timestamp: Date.now() });
    }
  };

  page.on('request', requestListener);
  page.on('response', responseListener);
  page.on('framenavigated', navigationListener);

  state.networkRecorderBoundPage = page as any;
  state.networkRecorderListeners = {
    request: requestListener,
    response: responseListener,
    framenavigated: navigationListener,
  } as any;

  notifyProgress('network_recorder', 'started', 'Power recording started (requests + responses + API interception + WebSocket + navigations)');
}

export function stopRecording() {
  state.isRecordingNetwork = false;
  detachNetworkRecorderListeners();
  notifyProgress('network_recorder', 'completed', `Recording stopped: ${state.networkRecords.length} events captured`);
}

export async function clearRecording(page: any) {
  state.networkRecords = [];
  try { await page.evaluate(() => { window.__interceptedApis = []; window.__wsMessages = []; }); } catch (e) { }
  notifyProgress('network_recorder', 'completed', 'Network records cleared');
}

export function getMediaRecords() {
  const mediaRecords = state.networkRecords.filter((r: any) => r.isMedia);
  return { success: true, count: mediaRecords.length, mediaUrls: mediaRecords.map((r: any) => ({ url: r.url, type: r.mediaType })) };
}

export function getNavigationRecords() {
  const navRecords = state.networkRecords.filter((r: any) => r.type === 'navigation');
  return { success: true, count: navRecords.length, navigations: navRecords };
}

export function getApiCallRecords() {
  const apiRecords = state.networkRecords.filter((r: any) => r.isApiCall);
  return {
    success: true, count: apiRecords.length,
    apiCalls: apiRecords.map((r: any) => ({
      url: r.url, method: r.method || 'GET', status: r.status,
      contentType: r.contentType, resourceType: r.resourceType,
      requestBody: r.requestBody || null, responseBody: r.responseBody || null,
      responseJson: r.responseJson || null, timestamp: r.timestamp
    }))
  };
}

export async function getInterceptedApis(page: any) {
  try {
    const intercepted = await page.evaluate(() => window.__interceptedApis || []);
    return {
      success: true, count: intercepted.length, interceptedApis: intercepted,
      note: 'These are runtime-intercepted API calls captured via monkey-patched fetch/XHR/sendBeacon (pre-page-load injection)'
    };
  } catch (e: any) {
    return { success: false, error: 'Failed to retrieve intercepted APIs: ' + e.message, interceptedApis: [] };
  }
}

export async function getWebSocketRecords(page: any) {
  try {
    const wsData = await page.evaluate(() => window.__wsMessages || []);
    const totalMessages = wsData.reduce((sum: number, ws: any) => sum + ws.messages.length, 0);
    return {
      success: true, count: wsData.length, totalMessages, websockets: wsData,
      note: 'WebSocket connections and messages captured via constructor monkey-patch'
    };
  } catch (e: any) {
    return { success: false, error: 'Failed to retrieve WebSocket data: ' + e.message, websockets: [] };
  }
}

export function getGraphQLRecords() {
  const gqlRecords = state.networkRecords.filter((r: any) =>
    r.isApiCall && r.requestBody && (r.requestBody.includes('"query"') || r.requestBody.includes('query '))
  ).map((r: any) => {
    let parsedQuery = null, parsedVariables = null, operationName = null;
    try {
      const body = JSON.parse(r.requestBody);
      parsedQuery = body.query;
      parsedVariables = body.variables;
      operationName = body.operationName;
    } catch (e) {}
    return {
      url: r.url, method: r.method, operationName: operationName || 'unknown',
      query: parsedQuery || r.requestBody, variables: parsedVariables,
      response: r.responseJson || r.responseBody, timestamp: r.timestamp
    };
  });
  return { success: true, count: gqlRecords.length, graphql: gqlRecords };
}

export function exportHAR() {
  const requests = state.networkRecords.filter((r: any) => r.type === 'request');
  const responses = state.networkRecords.filter((r: any) => r.type === 'response');
  const requestMap = new Map();
  for (const req of requests) {
    if (!requestMap.has(req.url)) requestMap.set(req.url, req);
  }

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Real Browser MCP', version: '1.5' },
      entries: responses.map((r: any) => {
        const matchingReq = requestMap.get(r.url);
        return {
          startedDateTime: new Date(r.timestamp).toISOString(),
          request: {
            method: r.method || 'GET', url: r.url,
            headers: matchingReq ? Object.entries(matchingReq.headers || {}).map(([name, value]) => ({ name, value: String(value) })) : [],
            postData: r.requestBody ? { text: r.requestBody } : undefined
          },
          response: {
            status: r.status || 200,
            headers: Object.entries(r.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
            content: { mimeType: r.contentType || 'text/plain', text: r.responseBody || '', size: (r.responseBody || '').length }
          },
          time: 0
        };
      })
    }
  };
  return { success: true, count: har.log.entries.length, har };
}

export function getFilteredRecords(filter: any) {
  let records = state.networkRecords;
  if (filter.resourceType) records = records.filter((r: any) => r.resourceType === filter.resourceType);
  if (filter.urlPattern) {
    const regex = new RegExp(filter.urlPattern);
    records = records.filter((r: any) => regex.test(r.url));
  }
  if (filter.type) records = records.filter((r: any) => r.type === filter.type);
  if (filter.mediaOnly) records = records.filter((r: any) => r.isMedia);
  return { success: true, recording: state.isRecordingNetwork, count: records.length, records: records.slice(-200) };
}

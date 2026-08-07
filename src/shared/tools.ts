const TOOLS = [
  // 1. Browser Init
  {
    name: 'browser_init',
    emoji: '🚀',
    description: 'Initialize a browser session with configurable options: headless mode, proxy, viewport, video recording, and ad blocking. Automatically recovers stale sessions.',
    descriptionHindi: 'ब्राउज़र सेशन शुरू करना',
    category: 'browser',
    requiresBrowser: false,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', default: false },
        proxy: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
            username: { type: 'string' },
            password: { type: 'string' }
          }
        },
        contextOptions: {
          type: 'object',
          description: 'Playwright BrowserContext options (viewport, userAgent, geolocation, permissions, httpCredentials, extraHTTPHeaders, etc.)'
        },
        turnstile: { type: 'boolean', default: false, description: 'Automatically handle embedded JS verification widgets on pages' },
        enableBlocker: { type: 'boolean', default: true, description: 'Block ads and trackers' },
        aiHealing: { type: 'boolean', default: true, description: 'Enable selector fallback when a selector does not match' },
        recordVideo: { type: 'boolean', default: false, description: 'Record continuous video of the session' }
      }
    }
  },

  // 2. Navigate
  {
    name: 'navigate',
    emoji: '🧭',
    description: 'Navigate to a URL with configurable wait conditions, timeout, and automatic retry on failure.',
    descriptionHindi: 'URL पर जाना (retry + recovery)',
    category: 'navigation',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle', 'commit'], default: 'networkidle' },
        timeout: { type: 'number', default: 30000 },
        retries: { type: 'number', default: 3, description: 'Retry count on failure' },
        smartWait: { type: 'boolean', default: true, description: 'Wait for page content to stabilize before returning' }
      },
      required: ['url']
    }
  },

  // 3. Get Content
  {
    name: 'get_content',
    emoji: '📄',
    description: 'Get page content in multiple formats: html, text, markdown, rawHttp, or elements. Extracts text, attributes, or bounding box coordinates. Can save directly to a file.',
    descriptionHindi: 'पेज का कंटेंट लेना — formats: html/text/markdown/rawHttp/elements',
    category: 'extraction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['html', 'text', 'markdown', 'rawHttp', 'elements'], default: 'text' },
        selector: { type: 'string', description: 'CSS selector' },
        xpath: { type: 'string', description: 'XPath selector' },
        text: { type: 'string', description: 'Find elements containing this text' },
        waitForJS: { type: 'boolean', default: true, description: 'Wait for JavaScript to finish rendering' },
        timeout: { type: 'number', default: 10000 },
        aiHeal: { type: 'boolean', default: true, description: 'Try alternative selectors if primary selector fails' },
        extractAttributes: { type: 'boolean', default: false, description: 'Extract all element attributes' },
        multiple: { type: 'boolean', default: false, description: 'Return multiple matching elements (for format=elements)' },
        includeMeta: { type: 'boolean', default: false, description: 'Include page title and URL at the top' },
        saveAs: { type: 'string', description: 'Absolute file path to save extracted content to disk' },
        rawHttpUrl: { type: 'string', description: 'URL to fetch raw HTTP without JS rendering. Defaults to current page URL.' }
      }
    }
  },

  // 4. Wait
  {
    name: 'wait',
    emoji: '⏳',
    description: 'Wait for a selector, navigation event, networkidle state, or a fixed timeout before continuing.',
    descriptionHindi: 'इंतजार करना (selector/navigation/networkidle/timeout)',
    category: 'utility',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['selector', 'navigation', 'timeout', 'networkidle'], default: 'timeout' },
        value: { type: 'string', description: 'Selector string or timeout value in ms' },
        timeout: { type: 'number', default: 30000 },
        aiOptimize: { type: 'boolean', default: true, description: 'Adjust wait time based on page load patterns' }
      }
    }
  },

  // 5. Click
  {
    name: 'click',
    emoji: '👆',
    description: 'Click a page element by CSS selector or annotation ID. Supports iframe context, hover before click, video player API, and automatic retry with fallback selectors.',
    descriptionHindi: 'क्लिक करना (selector fallback + iframe + video player support)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element to click' },
        annotationId: { type: 'number', description: 'Annotation number from see_page(annotate:true) — use instead of selector' },
        humanLike: { type: 'boolean', default: true, description: 'Smooth cursor movement before click' },
        aiHeal: { type: 'boolean', default: true, description: 'Try alternative selector if primary fails' },
        autoAcceptDialogs: { type: 'boolean', default: true, description: 'Auto-dismiss browser dialogs (alerts, confirms)' },
        retries: { type: 'number', default: 3, description: 'Retry count on failure' },
        clickCount: { type: 'number', default: 1 },
        delay: { type: 'number', default: 0 },
        timeout: { type: 'number', default: 60000, description: 'Max time to wait for element to appear (ms)' },
        hoverFirst: { type: 'boolean', default: false, description: 'Hover over element before clicking (for dynamic controls)' },
        hoverOnly: { type: 'boolean', default: false, description: 'Hover only, do not click (to reveal hidden controls)' },
        hoverDuration: { type: 'number', default: 500, description: 'Wait time after hover before clicking (ms)' },
        iframe: { type: 'number', description: 'Target a specific iframe by index (use media_extractor list_iframes to get index)' },
        iframeSelector: { type: 'string', description: 'Target a specific iframe by CSS selector' },
        scrollIntoView: { type: 'boolean', default: true, description: 'Scroll element into view before clicking' },
        forceClick: { type: 'boolean', default: false, description: 'Click via JavaScript even if element is not visible' },
        autoDetectPlayer: { type: 'boolean', default: false, description: 'Detect and target embedded video player iframes automatically' },
        usePlayerAPI: { type: 'boolean', default: true, description: 'Control video player via its JavaScript API instead of DOM click' },
        waitForPlay: { type: 'boolean', default: false, description: 'Wait until the video starts playing after click' },
        playerTimeout: { type: 'number', default: 15000, description: 'Max time to wait for video playback to start (ms)' }
      },
      anyOf: [
        { required: ['selector'] },
        { required: ['annotationId'] }
      ]
    }
  },

  // 6. Type
  {
    name: 'type',
    emoji: '⌨️',
    description: 'Type text into an input field with configurable keystroke delay, field clearing, and iframe support.',
    descriptionHindi: 'टेक्स्ट टाइप करना (keystroke delay + iframe support)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input field' },
        annotationId: { type: 'number', description: 'Annotation number from see_page(annotate:true) — use instead of selector' },
        text: { type: 'string' },
        delay: { type: 'number', default: 50, description: 'Delay between keystrokes in ms' },
        clear: { type: 'boolean', default: true, description: 'Clear the field before typing' },
        aiHeal: { type: 'boolean', default: true, description: 'Try alternative selector if primary fails' },
        iframe: { type: 'number', description: 'Target a specific iframe by index' },
        iframeSelector: { type: 'string', description: 'Target a specific iframe by CSS selector' },
        pressEnter: { type: 'boolean', default: false, description: 'Press Enter after typing' },
        waitForSelector: { type: 'boolean', default: true, description: 'Wait for the element to appear before typing' }
      },
      required: ['text'],
      anyOf: [
        { required: ['selector'] },
        { required: ['annotationId'] }
      ]
    }
  },

  // 7. Browser Close
  {
    name: 'browser_close',
    emoji: '🔴',
    description: 'Close the browser session and optionally save cookies for reuse in the next session.',
    descriptionHindi: 'ब्राउज़र बंद करना',
    category: 'browser',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', default: false, description: 'Force-kill the browser process' },
        saveSession: { type: 'boolean', default: false, description: 'Save cookies and storage for the next session' }
      }
    }
  },

  // 8. Form Handler
  {
    name: 'solve_captcha',
    emoji: '📋',
    description: 'Handle page verification widgets and form automation for testing your own pages. Supports JS-based widgets, text or image recognition via OCR, and intelligent form field matching. Note: third-party hosted challenge services (reCAPTCHA, hCaptcha) are not supported.',
    descriptionHindi: 'वेरिफिकेशन widget + फॉर्म भरना (अपने पेज की टेस्टिंग, OCR powered)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['turnstile', 'text', 'image', 'auto'],
          default: 'auto',
          description: 'Widget type: turnstile (JS-based embedded widget), text (OCR on text image), image (OCR on image), auto (detect automatically). Third-party hosted services like reCAPTCHA or hCaptcha are not supported.'
        },
        timeout: { type: 'number', default: 30000 },
        captchaSelector: { type: 'string', description: 'CSS selector for the challenge image element (required for text/image type)' },
        inputSelector: { type: 'string', description: 'CSS selector for the answer input field' },
        refreshSelector: { type: 'string', description: 'CSS selector for the refresh/reload button' },
        lang: { type: 'string', default: 'eng', description: 'OCR language code: eng, hin, or eng+hin' },
        expectedLength: { type: 'number', description: 'Expected character length of the answer' },
        allowedChars: { type: 'string', description: 'Character set allowed in the answer' },
        maxRetries: { type: 'number', default: 3, description: 'Maximum OCR refresh attempts' },
        iframe: { type: 'number', description: 'Target a specific iframe by index' },
        iframeSelector: { type: 'string', description: 'Target a specific iframe by CSS selector' },
        formData: { type: 'object', description: 'Key-value pairs of form fields to fill (field names matched automatically to page inputs)' },
        formSelector: { type: 'string', description: 'CSS selector for the form element (auto-detected if not provided)' },
        submit: { type: 'boolean', default: false, description: 'Submit the form after filling all fields' },
        humanLike: { type: 'boolean', default: true, description: 'Type with variable keystroke delays' },
        aiMatch: { type: 'boolean', default: true, description: 'Match form fields by semantic similarity even if names differ' },
        analyzeFirst: { type: 'boolean', default: true, description: 'Inspect page structure before filling fields' }
      }
    }
  },

  // 9. Scroll
  {
    name: 'random_scroll',
    emoji: '📜',
    description: 'Scroll the page with configurable direction, amount, and automatic lazy-load triggering.',
    descriptionHindi: 'स्क्रॉल करना (direction/amount/lazy-load)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'random', 'smart'], default: 'smart' },
        amount: { type: 'number', default: 0, description: 'Pixels to scroll. 0 = auto-decide based on page content height' },
        smooth: { type: 'boolean', default: true },
        aiDetectLazyLoad: { type: 'boolean', default: true, description: 'Detect and trigger lazy-loaded content' }
      }
    }
  },

  // 10. Redirect Tracer
  {
    name: 'redirect_tracer',
    emoji: '🔀',
    description: 'Trace the complete redirect chain of a URL. Tracks HTTP 301/302, JavaScript navigation (window.location, setTimeout), and meta refresh tags. Returns the full path with status codes and headers.',
    descriptionHindi: 'redirect chain ट्रेस — HTTP 301/302 + JS navigation + meta refresh',
    category: 'network',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        maxRedirects: { type: 'number', default: 20 },
        includeHeaders: { type: 'boolean', default: false },
        followJS: { type: 'boolean', default: true, description: 'Track JavaScript-triggered navigations' },
        followMeta: { type: 'boolean', default: true, description: 'Track meta refresh redirects' },
        decodeURLs: { type: 'boolean', default: true, description: 'Automatically decode percent-encoded URLs in the chain' },
        timeout: { type: 'number', default: 30000, description: 'Navigation timeout in ms' }
      },
      required: ['url']
    }
  },

  // 11. Extract Data
  {
    name: 'extract_data',
    emoji: '🔎',
    description: 'Extract structured data from the current page in multiple modes: regex, json, meta, structured, auto, decode (decode encoded strings), apiDiscovery, cipher (decode encoded data), or links (all links including hidden and iframe links).',
    descriptionHindi: 'डेटा एक्सट्रैक्टर — modes: regex, json, meta, structured, auto, decode, apiDiscovery, cipher, links',
    category: 'extraction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['regex', 'json', 'meta', 'structured', 'auto', 'deobfuscate', 'apiDiscovery', 'decrypt', 'links'], default: 'auto' },
        pattern: { type: 'string', description: 'For regex mode: the regular expression pattern' },
        selector: { type: 'string', description: 'For structured/links mode: CSS selector to scope the extraction' },
        jsonPath: { type: 'string', description: 'For json mode: JSONPath expression' },
        source: { type: 'string', enum: ['html', 'text', 'scripts', 'ld+json', 'api', 'all'], default: 'all' },
        autoDecode: { type: 'boolean', default: true, description: 'Automatically decode Base64 or percent-encoded values in results' },
        flags: { type: 'string', default: 'gi', description: 'Regex flags' },
        encryptedData: { type: 'string', description: 'For cipher mode: the encoded string to decode' },
        autoFindKey: { type: 'boolean', default: true, description: 'For cipher mode: locate encoding key from page scripts automatically' },
        aesKey: { type: 'string', description: 'For cipher mode: symmetric cipher key' },
        aesIV: { type: 'string', description: 'For cipher mode: initialization vector' },
        includeHidden: { type: 'boolean', default: true, description: 'For links mode: include hidden/non-visible links' },
        searchIframes: { type: 'boolean', default: true, description: 'For links mode: search inside embedded frames' }
      }
    }
  },

  // 12. Press Key
  {
    name: 'press_key',
    emoji: '🎹',
    description: 'Press keyboard keys with configurable modifier keys, repeat count, and keystroke delay.',
    descriptionHindi: 'की प्रेस करना',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g. Enter, Tab, ArrowDown, a)' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys (Alt, Control, Meta, Shift)' },
        count: { type: 'number', default: 1, description: 'Number of times to press the key' },
        humanDelay: { type: 'boolean', default: true, description: 'Add natural delay between repeated presses' }
      },
      required: ['key']
    }
  },

  // 13. Progress Tracker
  {
    name: 'progress_tracker',
    emoji: '📈',
    description: 'Track multi-step task progress with estimated time remaining.',
    descriptionHindi: 'प्रोग्रेस ट्रैक करना',
    category: 'utility',
    requiresBrowser: false,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'update', 'complete', 'get', 'clear'], default: 'get' },
        taskName: { type: 'string' },
        progress: { type: 'number', description: 'Progress value from 0 to 100' },
        aiEstimate: { type: 'boolean', default: true, description: 'Estimate remaining time from current progress rate' }
      }
    }
  },

  // 14. Page Inspector
  {
    name: 'deep_analysis',
    emoji: '🧠',
    description: 'Inspect the current page in depth: DOM structure, scripts, stylesheets, accessibility, performance metrics, SEO tags, response headers, loaded technologies, and content-loading strategy recommendations.',
    descriptionHindi: 'पेज विश्लेषण — DOM, scripts, tech stack, SEO, headers, recommendations',
    category: 'analysis',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, default: ['all'], description: 'Analysis types to run (all, dom, scripts, accessibility, performance, seo, headers, tech)' },
        detailed: { type: 'boolean', default: true },
        aiInsights: { type: 'boolean', default: true, description: 'Include loading strategy recommendations' },
        detectAntiBot: { type: 'boolean', default: true, description: 'Identify page access-control and verification services' }
      }
    }
  },

  // 15. Network Recorder
  {
    name: 'network_recorder',
    emoji: '📡',
    description: 'Record and inspect all network activity. Supports 11 actions: start, stop, get, clear, get_media, get_navigations, get_api_calls, get_intercepted_apis, get_websockets, get_graphql, export_har.',
    descriptionHindi: 'नेटवर्क रिकॉर्डर — start/stop/get/clear/get_media/get_navigations/get_api_calls/get_websockets/get_graphql/export_har',
    category: 'network',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'get', 'clear', 'get_media', 'get_navigations', 'get_api_calls', 'get_intercepted_apis', 'get_websockets', 'get_graphql', 'export_har'], default: 'get' },
        filter: {
          type: 'object',
          properties: {
            resourceType: { type: 'string' },
            urlPattern: { type: 'string' },
            type: { type: 'string' },
            mediaOnly: { type: 'boolean' }
          }
        },
        aiDetectStreams: { type: 'boolean', default: true, description: 'Identify video and audio stream URLs in recorded requests' },
        captureXhrBody: { type: 'boolean', default: false, description: 'Capture fetch/XHR response bodies (JSON or form-urlencoded)' }
      }
    }
  },

  // 16. Media Extractor
  {
    name: 'media_extractor',
    emoji: '🎬',
    description: 'Extract and control media from the current page. Supports 6 actions: extract (find video/audio/HLS/DASH/download URLs including nested iframes), list_iframes, switch_iframe, player_control (play/pause/seek/sources via player API), decode_url (url/base64/aes encoding), batch_extract.',
    descriptionHindi: 'मीडिया एक्सट्रैक्टर — 6 actions: extract/list_iframes/switch_iframe/player_control/decode_url/batch_extract',
    category: 'extraction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['extract', 'list_iframes', 'switch_iframe', 'player_control', 'decode_url', 'batch_extract'],
          default: 'extract'
        },
        types: { type: 'array', items: { type: 'string' }, default: ['all'], description: 'Media types to find: video, audio, hls, dash, download, iframes' },
        quality: { type: 'string', enum: ['best', 'worst', 'all'], default: 'best' },
        deep: { type: 'boolean', default: true, description: 'Also scan inline scripts and data attributes' },
        searchIframes: { type: 'boolean', default: true },
        selector: { type: 'string', description: 'iframe CSS selector' },
        index: { type: 'number', description: 'iframe index number' },
        playerAction: { type: 'string', enum: ['info', 'play', 'pause', 'seek', 'sources'], default: 'info' },
        encodedData: { type: 'string', description: 'Encoded URL or data string to decode (for decode_url action)' },
        decoderType: { type: 'string', enum: ['auto', 'url', 'base64', 'aes'], default: 'auto' },
        aesKey: { type: 'string', description: 'Cipher key (for aes decoder)' },
        aesIV: { type: 'string', description: 'Initialization vector (for aes decoder, optional)' },
        urls: { type: 'array', items: { type: 'string' }, description: 'List of URLs for batch_extract action' },
        aiOptimize: { type: 'boolean', default: true, description: 'Select extraction strategy automatically' }
      }
    }
  },

  // 17. Execute JS
  {
    name: 'execute_js',
    emoji: '💻',
    description: 'Execute custom JavaScript in the page context with async support, return value capture, and iframe targeting.',
    descriptionHindi: 'कस्टम JS चलाना (async + iframe context)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute in the page context' },
        returnValue: { type: 'boolean', default: true, description: 'Return the result of the expression' },
        async: { type: 'boolean', default: false, description: 'Wrap code in an async function' },
        timeout: { type: 'number', default: 30000 },
        iframe: { type: 'number', description: 'Execute inside a specific iframe (0 = main frame, 1+ = iframe by index)' },
        iframeSelector: { type: 'string', description: 'Execute inside iframe matched by CSS selector' },
        waitForIframe: { type: 'boolean', default: true, description: 'Wait for the iframe to finish loading before executing' }
      },
      required: ['code']
    }
  },

  // 18. Storage Inspector
  {
    name: 'storage_inspector',
    emoji: '🗄️',
    description: 'Inspect client-side storage: IndexedDB databases and registered Service Workers on the current page.',
    descriptionHindi: 'IndexedDB और Service Worker चेक करना',
    category: 'analysis',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['indexeddb', 'service_workers'], default: 'indexeddb' }
      }
    }
  },

  // 19. Replay Request
  {
    name: 'replay_request',
    emoji: '🔁',
    description: 'Re-send a network request inside the page context, reusing the current session cookies and headers.',
    descriptionHindi: 'नेटवर्क रिक्वेस्ट को session context में फिर से भेजना',
    category: 'network',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string', default: 'GET' },
        headers: { type: 'object' },
        body: { type: 'string' }
      },
      required: ['url']
    }
  },

  // 20. API Analyzer
  {
    name: 'api_analyzer',
    emoji: '🧩',
    description: 'Generate JSON schemas from API responses, diff two JSON objects, or create SDK boilerplate code in Python or TypeScript.',
    descriptionHindi: 'API रिस्पांस से Schema/SDK/Diff बनाना',
    category: 'analysis',
    requiresBrowser: false,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['schema', 'diff', 'sdk'], default: 'schema' },
        data: { type: 'string', description: 'JSON string (for schema/diff) or URL (for sdk)' },
        data2: { type: 'string', description: 'Second JSON string for diff comparison' },
        lang: { type: 'string', enum: ['ts', 'python'], default: 'ts' }
      },
      required: ['action', 'data']
    }
  },

  // 21. See Page
  {
    name: 'see_page',
    emoji: '👁️',
    description: 'Capture a snapshot of the current page. Returns a screenshot image together with optional full-page text, an interactive element map (buttons, links, inputs with position and selector), and an iframe inventory — all in a single call.\n\nWorkflow: Call once with fullPage:true and annotate:true. From that snapshot, run all planned actions (click, type, scroll, wait, extract) as a steps array without re-capturing the page. Call see_page again only when the page genuinely changes (new navigation, modal, or dynamic content load).',
    descriptionHindi: 'पेज snapshot — screenshot + page text + elements map + iframe list एक call में। steps array से लगातार actions चलाओ।',
    category: 'vision',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        annotate: { type: 'boolean', default: false, description: 'Draw numbered bounding boxes over interactive elements for precise targeting' },
        fullPage: { type: 'boolean', default: false, description: 'Capture the full scrollable page instead of only the visible viewport' },
        format: { type: 'string', enum: ['png', 'jpeg'], default: 'jpeg' },
        quality: { type: 'number', default: 70, description: 'JPEG quality 0-100' },
        includeElements: { type: 'boolean', default: true, description: 'Include the interactive element map in the response' },
        includeDomText: { type: 'boolean', default: false, description: 'Include the full DOM text content' },
        includePageText: { type: 'boolean', default: true, description: 'Include cleaned page text' },
        scanIframes: { type: 'boolean', default: true, description: 'List embedded iframes with their index and URL' },
        maxElements: { type: 'number', default: 60, description: 'Maximum number of interactive elements to map' },
        path: { type: 'string', description: 'File path to also save the screenshot image' },
        autoHover: { type: 'boolean', default: false, description: 'Hover over navigation menus before capturing to reveal dropdowns' },
        watchMutations: { type: 'boolean', default: false, description: 'Report DOM mutations (popups, alerts) since the last capture' },
        steps: {
          type: 'array',
          description: 'Actions to run sequentially right after capturing the page, without re-capturing between steps. Supported: click, type, press_key, scroll, wait, extract, see.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'type', 'press_key', 'scroll', 'wait', 'extract', 'see'] },
              selector: { type: 'string' },
              annotationId: { type: 'number' },
              text: { type: 'string' },
              key: { type: 'string' },
              modifiers: { type: 'array', items: { type: 'string' } },
              count: { type: 'number' },
              direction: { type: 'string', enum: ['up', 'down', 'random', 'smart'] },
              amount: { type: 'number' },
              smooth: { type: 'boolean', default: true },
              value: { type: 'string' },
              waitType: { type: 'string', enum: ['selector', 'navigation', 'timeout', 'networkidle'] },
              timeout: { type: 'number' },
              format: { type: 'string', enum: ['html', 'text', 'markdown', 'rawHttp', 'elements'] },
              xpath: { type: 'string' },
              fullPage: { type: 'boolean' },
              includePageText: { type: 'boolean', default: true },
              scanIframes: { type: 'boolean', default: true },
              humanLike: { type: 'boolean', default: true },
              retries: { type: 'number', default: 2 },
              pressEnter: { type: 'boolean' },
              clear: { type: 'boolean', default: true },
              annotate: { type: 'boolean' }
            }
          }
        },
        captureBefore: { type: 'boolean', default: true, description: 'Take a screenshot before running the steps array' },
        captureAfter: { type: 'boolean', default: true, description: 'Take a screenshot after the steps array completes' },
        stopOnError: { type: 'boolean', default: true, description: 'Stop step execution on first failure' }
      }
    }
  }
];

// Tool categories
const CATEGORIES = {
  browser: { name: 'Browser', emoji: '🌐', description: 'Browser lifecycle management' },
  navigation: { name: 'Navigation', emoji: '🧭', description: 'Page navigation' },
  interaction: { name: 'Interaction', emoji: '👆', description: 'User interactions' },
  extraction: { name: 'Extraction', emoji: '📄', description: 'Content extraction and reading' },
  network: { name: 'Network', emoji: '📡', description: 'Network operations' },
  analysis: { name: 'Analysis', emoji: '🧠', description: 'Page analysis' },
  vision: { name: 'Vision', emoji: '👁️', description: 'Page snapshot and visual inspection' },
  utility: { name: 'Utility', emoji: '🛠️', description: 'Utility tools' }
};

const TOOL_DISPLAY = TOOLS.map(t => ({
  name: t.name,
  emoji: t.emoji,
  description: t.description,
  descriptionHindi: (t as any).descriptionHindi,
  category: t.category
}));

module.exports = { TOOLS, TOOL_DISPLAY, CATEGORIES };
export {}

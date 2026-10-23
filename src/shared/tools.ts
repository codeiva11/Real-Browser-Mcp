const TOOLS = [
  // 1. Browser Init
  {
    name: 'browser_init',
    emoji: '🚀',
    description: 'Initialize a browser session with configurable options: headless mode, proxy, viewport, video recording, resource filtering, biometric anti-detection hardware spoofing (WebGL, Canvas, AudioContext), and WebRTC leak protection. Automatically recovers stale sessions.',
    descriptionHindi: 'ब्राउज़र सेशन शुरू करना (एंटी-डिटेक्शन + हार्डवेयर स्पूफिंग + WebRTC सुरक्षा)',
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
        widgetAssist: { type: 'boolean', default: false, description: 'Automatically interact with embedded page widgets and challenge elements when present' },
        enableBlocker: { type: 'boolean', default: true, description: 'Filter auxiliary scripts, telemetry, and background tracking requests' },
        aiHealing: { type: 'boolean', default: true, description: 'Enable selector fallback when a selector does not match' },
        recordVideo: { type: 'boolean', default: false, description: 'Record continuous video of the session' },
        spoofFingerprint: { type: 'boolean', default: true, description: 'Spoof WebGL vendor/renderer, Canvas noise, and AudioContext to defeat bot fingerprinting' },
        blockWebRTCLeaks: { type: 'boolean', default: true, description: 'Prevent local IP leaks via WebRTC when using proxies' },
        fingerprint: {
          type: ['string', 'object'],
          description: "Fingerprint profile: 'random' picks a coherent realistic profile (UA + viewport + timezone + locale), or pass an object {userAgent, viewport:{width,height}, timezoneId, locale, geolocation, colorScheme}. Explicit contextOptions win on conflict."
        }
      }
    }
  },

  // 2. Navigate
  {
    name: 'navigate',
    emoji: '🧭',
    description: 'Navigate to a URL or manage browser tabs (list, switch, new tab, close tab). Supports configurable wait conditions, timeout, automatic retry on failure, and waitForChallenge to auto-solve Cloudflare-style JS challenges.',
    descriptionHindi: 'URL पर जाना एवं टैब प्रबंधन (list/switch/new/close)',
    category: 'navigation',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to (required unless tabAction is list, new, or close without url)' },
        tabAction: { type: 'string', enum: ['navigate', 'list', 'switch', 'new', 'close'], default: 'navigate', description: 'Tab management action: navigate (default), list (show all tabs), switch (switch active tab), new (open new tab), close (close tab)' },
        tabIndex: { type: 'number', description: 'Zero-based index of the tab to switch to or close' },
        autoSwitchNewTab: { type: 'boolean', default: true, description: 'Automatically switch to newly opened popups or blank target tabs' },
        waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle', 'commit'], default: 'networkidle' },
        timeout: { type: 'number', default: 30000, maximum: 60000 },
        retries: { type: 'number', default: 3, maximum: 3, description: 'Retry count on failure' },
        smartWait: { type: 'boolean', default: true, description: 'Wait for page content to stabilize before returning' },
        waitForChallenge: { type: 'boolean', default: false, description: 'After navigation, wait for Cloudflare-style JS challenge ("Just a moment") to auto-solve; returns challenge status + clearance cookies' },
        challengeTimeout: { type: 'number', default: 90000, maximum: 90000, description: 'Max ms to wait for challenge to clear (with waitForChallenge)' },
        challengePollInterval: { type: 'number', default: 2000, description: 'Poll interval ms while waiting for challenge' }
      }
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
        timeout: { type: 'number', default: 30000, maximum: 60000 }
      }
    }
  },

  // 5. Click
  {
    name: 'click',
    emoji: '👆',
    description: 'Click or drag a page element by CSS selector or annotation ID. Supports drag-and-drop / slider manipulation via dragTo, iframe context, hover before click, video player API, and automatic retry with fallback selectors.',
    descriptionHindi: 'क्लिक या ड्रैग करना (drag-and-drop + selector fallback + iframe + video player support)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element to click' },
        annotationId: { type: 'number', description: 'Annotation number from see_page(annotate:true) — use instead of selector' },
        dragTo: {
          type: 'object',
          description: 'Drag and drop the source element to target selector or coordinates with biological friction and overshoot correction',
          properties: {
            selector: { type: 'string', description: 'Target CSS selector to drop onto' },
            x: { type: 'number', description: 'Target X coordinate' },
            y: { type: 'number', description: 'Target Y coordinate' },
            dropDelay: { type: 'number', default: 120, description: 'Delay before releasing mouse button in ms' },
            hesitateMidway: { type: 'boolean', default: true, description: 'Simulate natural intermediate hesitation/friction' }
          }
        },
        humanLike: { type: 'boolean', default: true, description: 'Smooth cursor movement before click' },
        aiHeal: { type: 'boolean', default: true, description: 'Try alternative selector if primary fails' },
        autoAcceptDialogs: { type: 'boolean', default: true, description: 'Auto-dismiss browser dialogs (alerts, confirms)' },
        retries: { type: 'number', default: 3, maximum: 5, description: 'Retry count on failure' },
        clickCount: { type: 'number', default: 1 },
        delay: { type: 'number', default: 0, maximum: 1000 },
        timeout: { type: 'number', default: 60000, maximum: 60000, description: 'Max time to wait for element to appear (ms)' },
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
        playerTimeout: { type: 'number', default: 15000, maximum: 30000, description: 'Max time to wait for video playback to start (ms)' }
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
        text: { type: 'string', maxLength: 10000 },
        delay: { type: 'number', default: 50, maximum: 200, description: 'Delay between keystrokes in ms' },
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
    description: 'Close the browser session and release all browser resources.',
    descriptionHindi: 'ब्राउज़र बंद करना',
    category: 'browser',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', default: false, description: 'Force-kill the browser process' }
      }
    }
  },

  // 8. Solve Captcha
  {
    name: 'solve_captcha',
    emoji: '📋',
    description: 'Automate form completion and interactive widget verification on web pages. Supports JavaScript-based challenge widgets, image text transcription, and intelligent form field mapping for QA and automated browsing workflows.',
    descriptionHindi: 'फॉर्म भरना और वेरिफिकेशन widget पूर्ण करना (अपने पेज की टेस्टिंग हेतु)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['js_widget', 'text', 'image', 'auto'],
          default: 'auto',
          description: 'Widget type: js_widget (JavaScript-based embedded challenge widget), text (text transcription verification), image (image-based input), auto (detect automatically).'
        },
        timeout: { type: 'number', default: 30000, maximum: 120000 },
        captchaSelector: { type: 'string', description: 'CSS selector targeting the verification element, canvas, image, or interactive widget container' },
        widgetSelector: { type: 'string', description: 'Alias for captchaSelector' },
        inputSelector: { type: 'string', description: 'CSS selector for the answer input field' },
        refreshSelector: { type: 'string', description: 'CSS selector for the reload/refresh button' },
        lang: { type: 'string', default: 'eng', description: 'Text recognition language code: eng, hin, or eng+hin' },
        expectedLength: { type: 'number', description: 'Expected character length of the answer' },
        allowedChars: { type: 'string', description: 'Character set allowed in the answer' },
        maxRetries: { type: 'number', default: 3, description: 'Maximum refresh attempts before giving up' },
        iframe: { type: 'number', description: 'Target a specific iframe by index' },
        iframeSelector: { type: 'string', description: 'Target a specific iframe by CSS selector' },
        formData: { type: 'object', description: 'Key-value pairs of form fields to fill (field names matched automatically to page inputs)' },
        formSelector: { type: 'string', description: 'CSS selector for the form element (auto-detected if not provided)' },
        submit: { type: 'boolean', default: false, description: 'Submit the form after filling all fields' },
        humanLike: { type: 'boolean', default: true, description: 'Type with variable keystroke delays' },
        aiMatch: { type: 'boolean', default: true, description: 'Match form fields by semantic similarity even if names differ' },
        analyzeFirst: { type: 'boolean', default: true, description: 'Inspect page structure before filling fields' },
        preferTextFallback: { type: 'boolean', default: false, description: 'Return text-only guidance instead of an image when the model cannot process images' }
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
        aiDetectLazyLoad: { type: 'boolean', default: true, description: 'Detect and trigger lazy-loaded content' },
        iframe: { type: 'number', description: 'Scroll inside a specific iframe by index instead of the main frame' },
        iframeSelector: { type: 'string', description: 'Scroll inside a specific iframe by CSS selector instead of the main frame' }
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
    description: 'Extract structured data from the current page in multiple modes: regex, json, meta, structured, auto, apiDiscovery, parse (string conversion), transform (data format conversion), or links (all links including nested iframes).',
    descriptionHindi: 'डेटा एक्सट्रैक्टर — modes: regex, json, meta, structured, auto, parse, apiDiscovery, transform, links',
    category: 'extraction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['regex', 'json', 'meta', 'structured', 'auto', 'parse', 'apiDiscovery', 'transform', 'links'], default: 'auto' },
        types: { type: 'array', items: { type: 'string' }, default: ['all'], description: 'For meta mode: which tag groups to include (all, meta, og, twitter)' },
        pattern: { type: 'string', description: 'For regex mode: the regular expression pattern' },
        selector: { type: 'string', description: 'For structured/links mode: CSS selector to scope the extraction' },
        jsonPath: { type: 'string', description: 'For json mode: JSONPath expression' },
        source: { type: 'string', enum: ['html', 'text', 'scripts', 'ld+json', 'api', 'all'], default: 'all' },
        autoDecode: { type: 'boolean', default: true, description: 'Automatically process Base64 or percent-encoded values in results' },
        flags: { type: 'string', default: 'gi', description: 'Regex flags' },
        inputData: { type: 'string', description: 'For transform mode: the string to convert' },
        autoDetectKey: { type: 'boolean', default: true, description: 'For transform mode: locate the conversion parameter from page scripts automatically' },
        transformKey: { type: 'string', description: 'For transform mode: optional conversion parameter' },
        keyOffset: { type: 'string', description: 'For transform mode: offset value (optional)' },
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
        count: { type: 'number', default: 1, maximum: 100, description: 'Number of times to press the key' },
        humanDelay: { type: 'boolean', default: true, description: 'Add natural delay between repeated presses' }
      },
      required: ['key']
    }
  },

  // 13. Page Inspector
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
        detailed: { type: 'boolean', default: true },
        aiInsights: { type: 'boolean', default: true, description: 'Include loading strategy recommendations' },
        detectAccessControls: { type: 'boolean', default: true, description: 'Identify embedded widgets and page components' }
      }
    }
  },

  // 15. Network Recorder
  {
    name: 'network_recorder',
    emoji: '📡',
    description: 'Record, inspect, and control network activity. Supports 14 actions: start, stop, get, clear, get_media, get_navigations, get_api_calls, get_intercepted_apis, get_websockets, get_graphql, export_har, block_urls (block images/trackers to boost speed 3x-5x), mock_route (intercept & mock API responses), clear_routes.',
    descriptionHindi: 'नेटवर्क रिकॉर्डर व रूट कंट्रोल — 14 actions (traffic recording + block_urls + mock_route + export_har)',
    category: 'network',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'get', 'clear', 'get_media', 'get_navigations', 'get_api_calls', 'get_intercepted_apis', 'get_websockets', 'get_graphql', 'export_har', 'block_urls', 'mock_route', 'clear_routes'], default: 'get' },
        filter: {
          type: 'object',
          properties: {
            resourceType: { type: 'string' },
            urlPattern: { type: 'string' },
            type: { type: 'string' },
            mediaOnly: { type: 'boolean' }
          }
        },
        patterns: { type: 'array', items: { type: 'string' }, description: 'URL patterns or glob filters for block_urls action (e.g. ["*.png", "*.jpg", "*google-analytics*"])' },
        mock: {
          type: 'object',
          description: 'Configuration for mock_route action',
          properties: {
            urlPattern: { type: 'string', description: 'URL pattern or regex string to intercept' },
            status: { type: 'number', default: 200, description: 'Mock HTTP status code' },
            contentType: { type: 'string', default: 'application/json', description: 'Mock response content type' },
            body: { type: 'string', description: 'Mock response body (JSON or text)' }
          }
        },
        aiDetectStreams: { type: 'boolean', default: true, description: 'Identify video and audio stream URLs in recorded requests' },
        captureXhrBody: { type: 'boolean', default: false, description: 'Capture fetch/XHR response bodies (JSON or form-urlencoded)' },
        limit: { type: 'number', maximum: 1000, description: 'For the get action: maximum records to return (default 200, hard max 1000). The result includes totalCount so you know when more records exist.' },
        offset: { type: 'number', description: 'For the get action: number of matching records to skip before returning (default 0). Use with limit to page through a recording.' }
      }
    }
  },

  // 16. Media Extractor
  {
    name: 'media_extractor',
    emoji: '🎬',
    description: 'Extract and control media from the current page. Supports 6 actions: extract (find video/audio/HLS/DASH/download URLs including nested iframes), list_iframes, switch_iframe, player_control (play/pause/seek/sources via player API), decode_url (inspect converted string and token formats), batch_extract.',
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
        encodedData: { type: 'string', description: 'String data to convert (for decode_url action)' },
        decoderType: { type: 'string', enum: ['auto', 'url', 'base64', 'custom'], default: 'auto', description: 'Conversion type: auto-detect, url, base64, or custom' },
        decoderKey: { type: 'string', description: 'Optional transformation parameter (for custom conversion)' },
        decoderIV: { type: 'string', description: 'Optional secondary parameter (for custom conversion)' },
        urls: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'List of URLs for batch_extract action' },
        async: { type: 'boolean', default: false, description: 'For batch_extract only: run as a background job — returns a jobId immediately instead of blocking; poll async_job for the result.' },
        aiOptimize: { type: 'boolean', default: true, description: 'Select extraction strategy automatically' }
      }
    }
  },

  // 17. Execute JS
  {
    name: 'execute_js',
    emoji: '💻',
    description: 'Execute custom JavaScript in the page context with async support, return value capture, and iframe targeting. Also supports action="fetch" to replay HTTP requests with the page session (cookies/auth inherited, 30s timeout, structured status/headers/body output).',
    descriptionHindi: 'कस्टम JS चलाना (async + iframe context) या fetch action से HTTP request भेजना',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', maxLength: 200000, description: 'JavaScript code to execute in the page context (required unless action="fetch")' },
        action: { type: 'string', enum: ['execute', 'fetch'], default: 'execute', description: 'execute: run JS code; fetch: replay an HTTP request with page session' },
        url: { type: 'string', description: 'URL for fetch action' },
        method: { type: 'string', default: 'GET', description: 'HTTP method for fetch action' },
        headers: { type: 'object', description: 'Headers for fetch action' },
        body: { type: 'string', description: 'Body for fetch action (POST/PUT)' },
        returnValue: { type: 'boolean', default: true, description: 'Return the result of the expression' },
        async: { type: 'boolean', default: false, description: 'Run as a background job: returns a jobId immediately instead of blocking; poll async_job for the result. Inside the job the code is wrapped in an async function, so top-level await works.' },
        timeout: { type: 'number', default: 30000 },
        iframe: { type: 'number', description: 'Execute inside a specific iframe (0 = main frame, 1+ = iframe by index)' },
        iframeSelector: { type: 'string', description: 'Execute inside iframe matched by CSS selector' },
        waitForIframe: { type: 'boolean', default: true, description: 'Wait for the iframe to finish loading before executing' }
      }
    }
  },

  // 18. Storage Inspector
  {
    name: 'storage_inspector',
    emoji: '🗄️',
    description: 'Inspect and manage client-side storage & sessions. Supports 7 actions: cookies (get all current cookies), save_session (persist cookies & storage state to file), load_session (restore state from file without re-logging), clear_cookies, autosave (auto-save session on every navigation), indexeddb, service_workers.',
    descriptionHindi: 'स्टोरेज व सेशन मैनेजर — cookies, save_session, load_session, clear_cookies, autosave, indexeddb, service_workers',
    category: 'analysis',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['cookies', 'save_session', 'load_session', 'clear_cookies', 'autosave', 'indexeddb', 'service_workers'], default: 'cookies' },
        sessionPath: { type: 'string', description: 'File path to save or load session state (cookies & localStorage) from disk' },
        passphrase: { type: 'string', description: 'AES-256-GCM passphrase. When provided with save_session the file is encrypted; required to load an encrypted session. Never logged or stored.' },
        enabled: { type: 'boolean', description: 'For autosave action: true to enable, false to disable' }
      }
    }
  },

  // 19. See Page
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
        maxElements: { type: 'number', default: 60, maximum: 200, description: 'Maximum number of interactive elements to map' },
        async: { type: 'boolean', default: false, description: 'When steps are present: run as a background job — returns a jobId immediately instead of blocking; poll async_job for the result.' },
        path: { type: 'string', description: 'File path to also save the screenshot image' },
        autoHover: { type: 'boolean', default: false, description: 'Hover over navigation menus before capturing to reveal dropdowns' },
        watchMutations: { type: 'boolean', default: false, description: 'Report DOM mutations (popups, alerts) since the last capture' },
        steps: {
          type: 'array',
          maxItems: 100,
          description: 'Actions to run sequentially right after capturing the page, without re-capturing between steps. Supported: click, type, press_key, scroll, wait, extract, see, drag, hover, double_click, triple_click, idle.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'type', 'press_key', 'scroll', 'wait', 'extract', 'see', 'drag', 'hover', 'double_click', 'triple_click', 'idle'] },
              selector: { type: 'string' },
              annotationId: { type: 'number' },
              targetSelector: { type: 'string', description: 'Drop target selector for drag action' },
              targetX: { type: 'number', description: 'Target X coordinate for drag action' },
              targetY: { type: 'number', description: 'Target Y coordinate for drag action' },
              duration: { type: 'number', description: 'Duration in ms for hover or idle actions' },
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
        stopOnError: { type: 'boolean', default: true, description: 'Stop step execution on first failure' },
        saveBaseline: { type: 'boolean', default: false, description: 'Save current screenshot as visual baseline for later comparison' },
        compareBaseline: { type: 'boolean', default: false, description: 'Compare current screenshot against saved baseline; returns diffPercent' }
      }
    }
  },

  // 20. Async Job (P2: background jobs for genuinely long work)
  {
    name: 'async_job',
    emoji: '📦',
    description: 'Poll or cancel background jobs started with async:true on media_extractor batch_extract, see_page steps, or execute_js. Read-only except cancel.',
    descriptionHindi: 'बैकग्राउंड job की स्थिति देखना / result लेना / cancel करना',
    category: 'utility',
    requiresBrowser: false,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'result', 'list', 'cancel'], default: 'status', description: 'status: job status + timing (no result payload); result: stored result/error once finished; list: recent jobs (metadata only); cancel: stop a running job' },
        jobId: { type: 'string', description: 'Job id returned by an async:true call (required for status/result/cancel)' }
      }
    }
  },
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

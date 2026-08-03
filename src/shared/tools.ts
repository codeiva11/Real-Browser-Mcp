const TOOLS = [
  // 1. Browser Init
  {
    name: 'browser_init',
    emoji: '🚀',
    description: 'Initialize a reliable browser session with automatic recovery and self-healing selectors.\n\n🤖 AI Usage Guide: Use this FIRST to start the browser session. Only run once per session.',
    descriptionHindi: 'ब्राउज़र सेशन शुरू करना (auto-recovery + self-healing)',
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
          description: 'Universal Playwright BrowserContext options (e.g. httpCredentials, geolocation, extraHTTPHeaders, permissions, viewport, userAgent, etc.)'
        },
        turnstile: { type: 'boolean', default: false, description: 'Automatically handle Cloudflare Turnstile challenges' },
        enableBlocker: { type: 'boolean', default: true, description: 'Block ads and trackers' },
        aiHealing: { type: 'boolean', default: true, description: 'Enable AI auto-healing for broken selectors' },
        recordVideo: { type: 'boolean', default: false, description: 'Record continuous video of session' }
      }
    }
  },

  // 2. Navigate
  {
    name: 'navigate',
    emoji: '🧭',
    description: 'Navigate to URL with smart retry, context recovery, and AI healing.\n\n🤖 AI Usage Guide: Use this right after browser_init to load a target website. Wait for networkidle by default.',
    descriptionHindi: 'URL पर जाना (smart retry + recovery)',
    category: 'navigation',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle', 'commit'], default: 'networkidle' },
        timeout: { type: 'number', default: 30000 },
        retries: { type: 'number', default: 3, description: 'Auto-retry on failures' },
        smartWait: { type: 'boolean', default: true, description: 'AI-powered smart waiting' }
      },
      required: ['url']
    }
  },

  // 3. Get Content
  {
    name: 'get_content',
    emoji: '📄',
    description: 'Get page content in multiple formats: html, text, markdown, rawHttp, or elements. Extracts text, attributes, or visual bounding boxes (rects). Can optionally save directly to a file.\n\n🤖 AI Usage Guide: Prefer format="rawHttp" for static sites to fetch raw HTML directly without JavaScript rendering (10x faster). If you need coordinates, use format="elements" with an xpath or text selector.',
    descriptionHindi: 'पेज का कंटेंट लेना — formats: html/text/markdown/rawHttp/elements। AI healing + selector/xpath/text targeting। Save to file option।',
    category: 'extraction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['html', 'text', 'markdown', 'rawHttp', 'elements'], default: 'text' },
        selector: { type: 'string', description: 'CSS selector (AI will auto-heal if broken)' },
        xpath: { type: 'string', description: 'XPath selector' },
        text: { type: 'string', description: 'Find elements containing exact text' },
        waitForJS: { type: 'boolean', default: true, description: 'Wait for JavaScript to render' },
        timeout: { type: 'number', default: 10000 },
        aiHeal: { type: 'boolean', default: true, description: 'Auto-fix broken selectors' },
        extractAttributes: { type: 'boolean', default: false, description: 'Extract all element attributes' },
        multiple: { type: 'boolean', default: false, description: 'Return multiple matching elements (for format=elements)' },
        includeMeta: { type: 'boolean', default: false, description: 'Include page title and URL at the top' },
        saveAs: { type: 'string', description: 'Absolute file path to save extracted content to disk' },
        rawHttpUrl: { type: 'string', description: 'URL to fetch raw HTTP (no JS). Defaults to current page URL if format is rawHttp.' }
      }
    }
  },

  // 4. Wait
  {
    name: 'wait',
    emoji: '⏳',
    description: 'Smart wait with AI prediction for optimal timing.\n\n🤖 AI Usage Guide: Avoid arbitrary timeouts. Use type="networkidle" or type="selector" to wait for elements to appear dynamically before interacting with them.',
    descriptionHindi: 'स्मार्ट इंतजार (AI prediction)',
    category: 'utility',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['selector', 'navigation', 'timeout', 'networkidle'], default: 'timeout' },
        value: { type: 'string', description: 'Selector or timeout value' },
        timeout: { type: 'number', default: 30000 },
        aiOptimize: { type: 'boolean', default: true, description: 'AI optimizes wait time based on page load patterns' }
      }
    }
  },

  // 5. Click
  {
    name: 'click',
    emoji: '👆',
    description: 'Reliable click with self-healing selectors, iframe support, hover for dynamic controls, and automatic video player detection.\n\n🤖 AI Usage Guide: If a CSS selector fails or you are unsure of the selector, DO NOT guess repeatedly. Call `see_page` with `annotate: true` to get the `annotationId`, then click using `annotationId` instead of `selector`.',
    descriptionHindi: 'क्लिक करना (self-healing selectors + iframe + auto video player detection)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (AI auto-heals if element not found)' },
        annotationId: { type: 'number', description: 'Alternative to selector: Pass the number from see_page(annotate: true) to click instantly' },
        humanLike: { type: 'boolean', default: true, description: 'Smooth natural cursor movement' },
        aiHeal: { type: 'boolean', default: true, description: 'Auto-find alternative selector if broken' },
        autoAcceptDialogs: { type: 'boolean', default: true, description: 'Auto-accept alerts/confirms to prevent blocking' },
        retries: { type: 'number', default: 3, description: 'Auto-retry on failure' },
        clickCount: { type: 'number', default: 1 },
        delay: { type: 'number', default: 0 },
        timeout: { type: 'number', default: 60000, description: 'Timeout for element to appear' },
        // Hover support for video player dynamic controls
        hoverFirst: { type: 'boolean', default: false, description: 'Hover before click (for dynamic controls like video players)' },
        hoverOnly: { type: 'boolean', default: false, description: 'Only hover, do not click (to reveal hidden controls)' },
        hoverDuration: { type: 'number', default: 500, description: 'Wait time after hover before click (ms)' },
        // iframe support
        iframe: { type: 'number', description: 'Execute in specific iframe index (use media_extractor list_iframes to get index)' },
        iframeSelector: { type: 'string', description: 'Alternative: iframe CSS selector instead of index' },
        // Scroll into view
        scrollIntoView: { type: 'boolean', default: true, description: 'Auto-scroll element into view before click' },
        forceClick: { type: 'boolean', default: false, description: 'Force click even if element not visible (use JS click)' },
        // NEW: Auto Video Player Detection & Control
        autoDetectPlayer: { type: 'boolean', default: false, description: 'Auto-detect video player iframe (JWPlayer, VideoJS, Plyr, VidStack, DooPlayer)' },
        usePlayerAPI: { type: 'boolean', default: true, description: 'Use player API (jwplayer.play()) instead of DOM click for reliable playback' },
        waitForPlay: { type: 'boolean', default: false, description: 'Wait until video actually starts playing' },
        playerTimeout: { type: 'number', default: 15000, description: 'Max wait time for video to start playing (ms)' }
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
    description: 'Type text with natural speed variation, smart clearing, and iframe support.\n\n🤖 AI Usage Guide: Like `click`, if the selector fails, use `see_page` with `annotate: true` and pass the `annotationId`.',
    descriptionHindi: 'टेक्स्ट टाइप करना (natural speed + iframe support)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        annotationId: { type: 'number', description: 'Alternative to selector: Pass the number from see_page(annotate: true) to type instantly' },
        text: { type: 'string' },
        delay: { type: 'number', default: 50, description: 'Keystroke delay with natural timing variation' },
        clear: { type: 'boolean', default: true },
        aiHeal: { type: 'boolean', default: true },
        // NEW: iframe support
        iframe: { type: 'number', description: 'Execute in specific iframe index' },
        iframeSelector: { type: 'string', description: 'Alternative: iframe CSS selector' },
        // NEW: Additional options
        pressEnter: { type: 'boolean', default: false, description: 'Press Enter after typing' },
        waitForSelector: { type: 'boolean', default: true, description: 'Wait for selector before typing' }
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
    description: 'Close browser with cleanup and session save',
    descriptionHindi: 'ब्राउज़र बंद करना',
    category: 'browser',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', default: false },
        saveSession: { type: 'boolean', default: false, description: 'Save cookies and storage for next session' }
      }
    }
  },

  // 8. Solve Captcha
  {
    name: 'solve_captcha',
    emoji: '🔓',
    description: 'Handle verification widgets and smart form automation for automated testing of your own pages (Turnstile challenges, text/image recognition via OCR). Note: reCAPTCHA/hCaptcha are not supported — use third-party services for those.',
    descriptionHindi: 'वेरिफिकेशन widget हैंडल करना + फॉर्म भरना (अपने पेज की टेस्टिंग के लिए, OCR powered)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        // === CAPTCHA OPTIONS ===
        type: {
          type: 'string',
          enum: ['turnstile', 'text', 'image', 'auto'],
          default: 'auto',
          description: 'Verification type: turnstile (JS-based), text/image (OCR-based), auto (detect). Note: reCAPTCHA/hCaptcha are not supported — use third-party services.'
        },
        timeout: { type: 'number', default: 30000 },
        captchaSelector: { type: 'string', description: 'CSS selector for captcha image (required for text/image type)' },
        inputSelector: { type: 'string', description: 'CSS selector for input field to fill result' },
        refreshSelector: { type: 'string', description: 'CSS selector for captcha refresh button' },
        lang: { type: 'string', default: 'eng', description: 'OCR language: eng, hin, eng+hin' },
        expectedLength: { type: 'number', description: 'Expected captcha text length' },
        allowedChars: { type: 'string', description: 'Allowed characters in captcha' },
        maxRetries: { type: 'number', default: 3, description: 'Max refresh attempts for OCR' },

        // === IFRAME SUPPORT ===
        iframe: { type: 'number', description: 'Execute in specific iframe index (use media_extractor list_iframes to get index)' },
        iframeSelector: { type: 'string', description: 'Alternative: iframe CSS selector instead of index' },

        // === FORM AUTOMATION OPTIONS (merged from form_automator) ===
        formData: { type: 'object', description: 'Form field data to fill (AI matches fields automatically)' },
        formSelector: { type: 'string', description: 'Form selector (AI auto-detects if not provided)' },
        submit: { type: 'boolean', default: false, description: 'Auto-submit form after filling and verification' },
        humanLike: { type: 'boolean', default: true, description: 'Natural typing with variable delays' },
        aiMatch: { type: 'boolean', default: true, description: 'AI matches fields even if names differ' },
        analyzeFirst: { type: 'boolean', default: true, description: 'Analyze page structure before solving' }
      }
    }
  },

  // 9. Random Scroll
  {
    name: 'random_scroll',
    emoji: '📜',
    description: 'Natural scrolling with adaptive pattern detection',
    descriptionHindi: 'स्क्रॉल करना (natural + adaptive)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'random', 'smart'], default: 'smart' },
        amount: { type: 'number', default: 0, description: '0 = AI decides based on content' },
        smooth: { type: 'boolean', default: true },
        aiDetectLazyLoad: { type: 'boolean', default: true, description: 'Auto-detect lazy loading patterns' }
      }
    }
  },



  // 10. Redirect Tracer
  {
    name: 'redirect_tracer',
    emoji: '🔀',
    description: 'Trace complete redirect chains including HTTP 301/302 redirects, JavaScript-based navigations (window.location, setTimeout redirects), and meta refresh tags. Auto-decodes encoded URLs in the chain. Returns full redirect path with status codes and headers.\n\n🤖 AI Usage Guide: Use this if a URL is failing to load or redirecting infinitely to understand the routing.',
    descriptionHindi: 'पूरी redirect chain ट्रेस — HTTP 301/302 + JS navigation + meta refresh। Auto URL decode।',
    category: 'network',
    requiresBrowser: true,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        maxRedirects: { type: 'number', default: 20 },
        includeHeaders: { type: 'boolean', default: false },
        followJS: { type: 'boolean', default: true, description: 'Track JS navigations' },
        followMeta: { type: 'boolean', default: true, description: 'Track meta refresh redirects' },
        decodeURLs: { type: 'boolean', default: true, description: 'Auto-decode encoded URLs in chain' },
        timeout: { type: 'number', default: 30000, description: 'Navigation timeout in milliseconds' }
      },
      required: ['url']
    }
  },

  // 11. Extract Data
  {
    name: 'extract_data',
    emoji: '🔎',
    description: 'Universal data extractor with 9 modes: (1) regex, (2) json, (3) meta, (4) structured, (5) auto, (6) deobfuscate (decode encoded strings), (7) apiDiscovery, (8) decrypt (decode encoded data), (9) links - extract all links including hidden, iframe, and encoded links.\n\n🤖 AI Usage Guide: Use this INSTEAD of executing custom JS (`execute_js`) to read data. If you need links, use type="links". For general info, use type="auto".',
    descriptionHindi: 'यूनिवर्सल डेटा एक्सट्रैक्टर — 9 modes: regex, json, meta, structured, auto, deobfuscate (decode), apiDiscovery, decrypt (decode), links।',
    category: 'extraction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['regex', 'json', 'meta', 'structured', 'auto', 'deobfuscate', 'apiDiscovery', 'decrypt', 'links'], default: 'auto' },
        pattern: { type: 'string', description: 'For regex: pattern to search' },
        selector: { type: 'string', description: 'For structured/links: CSS selector' },
        jsonPath: { type: 'string', description: 'For JSON: path expression' },
        source: { type: 'string', enum: ['html', 'text', 'scripts', 'ld+json', 'api', 'all'], default: 'all' },
        autoDecode: { type: 'boolean', default: true, description: 'Auto-decode Base64/URL in results' },
        flags: { type: 'string', default: 'gi', description: 'Regex flags' },
        encryptedData: { type: 'string', description: 'For decrypt: data to decode/decrypt' },
        autoFindKey: { type: 'boolean', default: true, description: 'For decrypt: automatically locate decoding keys from page scripts' },
        aesKey: { type: 'string', description: 'For decrypt: AES decryption key' },
        aesIV: { type: 'string', description: 'For decrypt: AES initialization vector' },
        includeHidden: { type: 'boolean', default: true, description: 'For links: Include hidden links' },
        searchIframes: { type: 'boolean', default: true, description: 'For links: Search inside iframes' }
      }
    }
  },

  // 12. Press Key
  {
    name: 'press_key',
    emoji: '🎹',
    description: 'Press keyboard keys with natural timing',
    descriptionHindi: 'की प्रेस करना',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        modifiers: { type: 'array', items: { type: 'string' } },
        count: { type: 'number', default: 1 },
        humanDelay: { type: 'boolean', default: true, description: 'Natural delay between presses' }
      },
      required: ['key']
    }
  },

  // 13. Progress Tracker
  {
    name: 'progress_tracker',
    emoji: '📈',
    description: 'Track automation progress with AI predictions',
    descriptionHindi: 'प्रोग्रेस ट्रैक करना (AI predictions)',
    category: 'utility',
    requiresBrowser: false,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'update', 'complete', 'get', 'clear'], default: 'get' },
        taskName: { type: 'string' },
        progress: { type: 'number', description: '0-100' },
        aiEstimate: { type: 'boolean', default: true, description: 'AI estimates remaining time' }
      }
    }
  },

  // 14. Deep Analysis
  {
    name: 'deep_analysis',
    emoji: '🧠',
    description: 'Deep page analysis: DOM structure, scripts, styles, accessibility, performance metrics, SEO tags, security headers, protection-service detection (Cloudflare, DataDome, reCAPTCHA), technology stack identification, and recommendations for the best content-loading strategy.\n\n🤖 AI Usage Guide: Use this if a page fails to load fully or if elements are unexpectedly absent, to check for protection services or iFrames.',
    descriptionHindi: 'गहरा पेज विश्लेषण — DOM, scripts, protection-service detection, tech stack, SEO, recommendations।',
    category: 'analysis',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, default: ['all'] },
        detailed: { type: 'boolean', default: true },
        aiInsights: { type: 'boolean', default: true, description: 'AI provides recommendations' },
        detectAntiBot: { type: 'boolean', default: true, description: 'Detect page protection services' }
      }
    }
  },

  // 15. Network Recorder
  {
    name: 'network_recorder',
    emoji: '📡',
    description: 'Record all network activity with 11 actions: (1) start, (2) stop, (3) get, (4) clear, (5) get_media, (6) get_navigations, (7) get_api_calls, (8) get_intercepted_apis, (9) get_websockets, (10) get_graphql - extract GraphQL queries/mutations, (11) export_har - generate HAR 1.2 format JSON.',
    descriptionHindi: 'नेटवर्क रिकॉर्डर — actions: start/stop/get/clear/get_media/get_navigations/get_api_calls/get_intercepted_apis/get_websockets/get_graphql/export_har।',
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
        aiDetectStreams: { type: 'boolean', default: true, description: 'AI detects video/audio streams' },
        captureXhrBody: { type: 'boolean', default: false, description: 'Capture fetch/XHR response bodies (JSON, form-urlencoded)' }
      }
    }
  },



  // 16. Media Extractor
  {
    name: 'media_extractor',
    emoji: '🎬',
    description: 'Universal media extractor with 6 actions: (1) extract - find all video/audio/HLS/DASH/download URLs from page + nested iframes (3+ levels deep), (2) list_iframes - list all iframes with indices, (3) switch_iframe - get iframe URL and info (use iframe/iframeSelector params on other tools to target specific iframes), (4) player_control - control video players (JWPlayer, VideoJS, Plyr, VidStack, DooPlayer) via API: play/pause/seek/sources, (5) decode_url - decode encoded URLs: auto/url/base64/aes with key+IV, (6) batch_extract - extract from multiple URLs at once.',
    descriptionHindi: 'मीडिया एक्सट्रैक्टर — 6 actions: extract/list_iframes/switch_iframe/player_control/decode_url/batch_extract। Video players + iframes + decoders।',
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
        // For extraction
        types: { type: 'array', items: { type: 'string' }, default: ['all'], description: 'video, audio, hls, dash, download, iframes' },
        quality: { type: 'string', enum: ['best', 'worst', 'all'], default: 'best' },
        deep: { type: 'boolean', default: true, description: 'Deep scan scripts and data attributes' },
        searchIframes: { type: 'boolean', default: true },
        // For iframe control
        selector: { type: 'string', description: 'iFrame selector' },
        index: { type: 'number', description: 'iFrame index' },
        // For player control
        playerAction: { type: 'string', enum: ['info', 'play', 'pause', 'seek', 'sources'], default: 'info' },
        // For decoders
        encodedData: { type: 'string', description: 'For decode_url action' },
        decoderType: { type: 'string', enum: ['auto', 'url', 'base64', 'aes'], default: 'auto' },
        aesKey: { type: 'string', description: 'AES decryption key' },
        aesIV: { type: 'string', description: 'AES IV (optional)' },
        // Batch operations
        urls: { type: 'array', items: { type: 'string' }, description: 'Multiple URLs for batch extraction' },
        aiOptimize: { type: 'boolean', default: true, description: 'AI optimizes extraction strategy' }
      }
    }
  },

  // 17. Execute JS
  {
    name: 'execute_js',
    emoji: '💻',
    description: 'Execute custom JavaScript with async support, error handling, and iframe context',
    descriptionHindi: 'कस्टम JS चलाना (async + iframe context support)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        returnValue: { type: 'boolean', default: true },
        async: { type: 'boolean', default: false, description: 'Execute async code' },
        timeout: { type: 'number', default: 30000 },
        // FIXED: iframe context now works properly
        iframe: { type: 'number', description: 'Execute in specific iframe index (0=main, 1+=iframes)' },
        iframeSelector: { type: 'string', description: 'Alternative: iframe CSS selector' },
        waitForIframe: { type: 'boolean', default: true, description: 'Wait for iframe to be ready' }
      },
      required: ['code']
    }
  },


  // 18. Storage Inspector
  {
    name: 'storage_inspector',
    emoji: '🗄️',
    description: 'Inspect IndexedDB and Service Workers natively via JS.',
    descriptionHindi: 'IndexedDB और Service Worker चेक करना।',
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
    description: 'Replay a captured API request directly within the page context, reusing the existing session cookies and headers.',
    descriptionHindi: 'कैप्चर की गई रिक्वेस्ट को पेज context में फिर से भेजना (मौजूदा session cookies के साथ)।',
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
    description: 'Generate schemas, diff JSONs, and create SDK boilerplates (Python/TypeScript).',
    descriptionHindi: 'API रिस्पांस से स्कीमा/SDK/Diff बनाना।',
    category: 'analysis',
    requiresBrowser: false,
    requiresPage: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['schema', 'diff', 'sdk'], default: 'schema' },
        data: { type: 'string', description: 'JSON string for schema/diff, or URL for SDK' },
        data2: { type: 'string', description: 'Second JSON string for diff action' },
        lang: { type: 'string', enum: ['ts', 'python'], default: 'ts' }
      },
      required: ['action', 'data']
    }
  },

  // 21. See Page (AI Vision)
  {
    name: 'see_page',
    emoji: '👁️',
    description: 'AI VISION ("eyes"): Visually SEE the current page exactly like a human does. Returns a screenshot image AND a RICH SINGLE-SHOT MAP of the entire page in one call: full page text, all visible interactive elements (buttons, links, inputs) with position/selector, AND an iframe inventory — so you can plan and execute a whole multi-step task from ONE view without re-capturing the page after every action.\n\n🤖 AI Usage Guide (HUMAN-LIKE WORKFLOW):\n1. Call see_page ONCE with fullPage:true, includePageText:true, scanIframes:true, annotate:true.\n2. From that single view, PLAN and RUN all actions for this page in a CONTINUOUS sequence WITHOUT re-capturing the page between steps. You can pass a `steps` array (click / type / press_key / scroll / wait / extract / see) and they run back-to-back in ONE flow — this is the unified task runner (the old separate browse_task tool is merged here to avoid confusion). A BEFORE and AFTER screenshot are captured automatically.\n3. ONLY call see_page AGAIN after the page genuinely changes (navigation to a new URL, a modal/popup opens, or new dynamic content loads). Never re-capture the same unchanged page.\n4. For multi-page tasks (login → dashboard → settings), let each navigation trigger a fresh single see_page, then continue the continuous action sequence. This mimics how a human watches a page once, acts, then looks again only when the page actually changes.',
    descriptionHindi: 'AI विज़न ("आँखें"): पेज को इंसान की तरह देखना — एक ही call में screenshot + पूरा page text + सभी clickable elements का map + iframe inventory। नियम: पहले एक बार fullPage:true से देखो, फिर उसी एक view से सारे actions (click/type/extract) लगातार करो बिना बीच-बीच में दोबारा screenshot लिए। दोबारा see_page सिर्फ तभी जब पेज वाकई बदले (navigation/modal/new content)। Multi-page tasks में हर नए पेज पर एक बार देखो, फिर लगातार काम करो — ठीक वैसे जैसे इंसान करता है।',
    category: 'vision',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        annotate: { type: 'boolean', default: false, description: 'Super Vision: Draw red bounding boxes with numbers over all interactive elements for instant click/type targeting' },
        fullPage: { type: 'boolean', default: false, description: 'See the entire scrollable page (true) or just the current viewport (false)' },
        format: { type: 'string', enum: ['png', 'jpeg'], default: 'jpeg', description: 'Image format (jpeg = smaller, faster for vision)' },
        quality: { type: 'number', default: 70, description: 'JPEG quality 0-100 (lower = smaller image to the AI)' },
        includeElements: { type: 'boolean', default: true, description: 'Include the visual map of interactive elements' },
        includeDomText: { type: 'boolean', default: false, description: 'Include the full text content of the page (DOM reading)' },
        includePageText: { type: 'boolean', default: true, description: 'Include cleaned page text so the agent can plan actions without re-capturing' },
        scanIframes: { type: 'boolean', default: true, description: 'List all iframes (index + url) so cross-frame navigation is planned in one view' },
        maxElements: { type: 'number', default: 60, description: 'Max number of interactive elements to map' },
        path: { type: 'string', description: 'Optional file path to also save the captured image' },
        autoHover: { type: 'boolean', default: false, description: 'Hover over menus before taking screenshot to reveal dropdowns' },
        watchMutations: { type: 'boolean', default: false, description: 'Check for DOM mutations (popups/alerts) since last view' },
        steps: {
          type: 'array',
          description: 'HUMAN-LIKE TASK RUNNER: optional list of actions to run in ONE continuous flow right after capturing the page — WITHOUT re-capturing between steps. Actions: click / type / press_key / scroll / wait / extract / see. Ideal for multi-step forms, wizards, and checkouts. Plan the whole task from this single page view, then hand the step list here. (Merged from the former browse_task tool.)',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'type', 'press_key', 'scroll', 'wait', 'extract', 'see'] },
              selector: { type: 'string', description: 'CSS selector (or use annotationId instead)' },
              annotationId: { type: 'number', description: 'Numeric id from a prior see_page(annotate:true)' },
              text: { type: 'string', description: 'For type: text to enter' },
              key: { type: 'string', description: 'For press_key: key to press' },
              modifiers: { type: 'array', items: { type: 'string' }, description: 'For press_key: modifier keys' },
              count: { type: 'number', description: 'For press_key: number of presses' },
              direction: { type: 'string', enum: ['up', 'down', 'random', 'smart'], description: 'For scroll' },
              amount: { type: 'number', description: 'For scroll: pixels' },
              smooth: { type: 'boolean', default: true, description: 'For scroll: smooth scrolling' },
              value: { type: 'string', description: 'For wait: selector/value' },
              waitType: { type: 'string', enum: ['selector', 'navigation', 'timeout', 'networkidle'], description: 'For wait' },
              timeout: { type: 'number', description: 'Per-step timeout (ms)' },
              format: { type: 'string', enum: ['html', 'text', 'markdown', 'rawHttp', 'elements'], description: 'For extract' },
              xpath: { type: 'string', description: 'For extract: xpath selector' },
              fullPage: { type: 'boolean', description: 'For see step: capture full scrollable page' },
              includePageText: { type: 'boolean', default: true, description: 'For see step: include page text' },
              scanIframes: { type: 'boolean', default: true, description: 'For see step: include iframe inventory' },
              humanLike: { type: 'boolean', default: true, description: 'For click: human-like cursor movement' },
              retries: { type: 'number', default: 2, description: 'For click: auto-retry count' },
              pressEnter: { type: 'boolean', description: 'For type: press Enter after typing' },
              clear: { type: 'boolean', default: true, description: 'For type: clear field before typing' },
              annotate: { type: 'boolean', description: 'For see step: annotate interactive elements' }
            }
          }
        },
        captureBefore: { type: 'boolean', default: true, description: 'Take a BEFORE screenshot when running steps' },
        captureAfter: { type: 'boolean', default: true, description: 'Take an AFTER screenshot when running steps' },
        stopOnError: { type: 'boolean', default: true, description: 'Stop the step sequence on first failure (true) or continue (false)' }
      }
    }
  },

  // 22. (removed) browse_task was merged into see_page (continuous `steps` workflow)
];

// Tool categories
const CATEGORIES = {
  browser: { name: 'Browser', emoji: '🌐', description: 'Browser lifecycle management' },
  navigation: { name: 'Navigation', emoji: '🧭', description: 'Page navigation' },
  interaction: { name: 'Interaction', emoji: '👆', description: 'User interactions' },
  extraction: { name: 'Extraction', emoji: '📄', description: 'Content extraction and reading' },
  network: { name: 'Network', emoji: '📡', description: 'Network operations' },
  analysis: { name: 'Analysis', emoji: '🧠', description: 'Page analysis' },

  vision: { name: 'Vision', emoji: '👁️', description: 'AI visual perception (reads page layout visually)' },
  utility: { name: 'Utility', emoji: '🛠️', description: 'Utility tools' }
};

// Export
const TOOL_DISPLAY = TOOLS.map(t => ({
  name: t.name,
  emoji: t.emoji,
  description: t.description,
  descriptionHindi: t.descriptionHindi,
  category: t.category
}));

module.exports = {
  TOOLS,
  TOOL_DISPLAY,
  CATEGORIES,
};
export {}

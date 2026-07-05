const TOOLS = [
  // 1. Browser Init
  {
    name: 'browser_init',
    emoji: '🚀',
    description: 'Initialize browser with stealth, anti-detection, and AI healing.\n\n🤖 AI Usage Guide: Use this FIRST to start the browser session. Only run once per session.',
    descriptionHindi: 'ब्राउज़र शुरू करना (stealth + AI healing)',
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
        turnstile: { type: 'boolean', default: false, description: 'Auto-solve Cloudflare Turnstile' },
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

  // 3. Get Content (MERGED: get_content + js_scrape + save_content_as_markdown + find_element)
  {
    name: 'get_content',
    emoji: '📄',
    description: 'Get page content in multiple formats: html, text, markdown, rawHttp, or elements. Extracts text, attributes, or visual bounding boxes (rects). Can optionally save directly to a file.\n\n🤖 AI Usage Guide: Prefer format="rawHttp" for static sites to bypass JS loading entirely (10x faster). If you need coordinates, use format="elements" with an xpath or text selector.',
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
      },
      required: ['value']
    }
  },

  // 5. Click (ENHANCED: iframe + hover + auto video player detection)
  {
    name: 'click',
    emoji: '👆',
    description: 'Human-like click with AI healing, iframe support, hover for dynamic controls, and auto video player detection.\n\n🤖 AI Usage Guide: If a CSS selector fails or you are unsure of the selector, DO NOT guess repeatedly. Call `see_page` with `annotate: true` to get the `annotationId`, then click using `annotationId` instead of `selector`.',
    descriptionHindi: 'क्लिक करना (AI healing + iframe + auto video player detection)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (AI auto-heals if element not found)' },
        annotationId: { type: 'number', description: 'Alternative to selector: Pass the number from see_page(annotate: true) to click instantly' },
        humanLike: { type: 'boolean', default: true, description: 'Ghost cursor human movement' },
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
      required: ['selector']
    }
  },

  // 6. Type (ENHANCED: iframe support)
  {
    name: 'type',
    emoji: '⌨️',
    description: 'Type text with human speed variation, smart clearing, and iframe support.\n\n🤖 AI Usage Guide: Like `click`, if the selector fails, use `see_page` with `annotate: true` and pass the `annotationId`.',
    descriptionHindi: 'टेक्स्ट टाइप करना (human speed + iframe support)',
    category: 'interaction',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        annotationId: { type: 'number', description: 'Alternative to selector: Pass the number from see_page(annotate: true) to type instantly' },
        text: { type: 'string' },
        delay: { type: 'number', default: 50, description: 'Keystroke delay with natural variation' },
        clear: { type: 'boolean', default: true },
        aiHeal: { type: 'boolean', default: true },
        // NEW: iframe support
        iframe: { type: 'number', description: 'Execute in specific iframe index' },
        iframeSelector: { type: 'string', description: 'Alternative: iframe CSS selector' },
        // NEW: Additional options
        pressEnter: { type: 'boolean', default: false, description: 'Press Enter after typing' },
        waitForSelector: { type: 'boolean', default: true, description: 'Wait for selector before typing' }
      },
      required: ['selector', 'text']
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

  // 8. Solve Captcha (MERGED with form_automator - Enhanced with OCR + Form Automation)
  {
    name: 'solve_captcha',
    emoji: '🔓',
    description: 'Auto-solve CAPTCHA with AI + Smart Form Automation (Turnstile, Text/Image OCR). Note: reCAPTCHA/hCaptcha are not supported — use third-party services for those.',
    descriptionHindi: 'CAPTCHA हल करना + फॉर्म भरना (AI + OCR powered)',
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
          description: 'Captcha type: turnstile (JS-based), text/image (OCR-based), auto (detect). Note: reCAPTCHA/hCaptcha are not supported — use third-party services.'
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
        submit: { type: 'boolean', default: false, description: 'Auto-submit form after filling and captcha solving' },
        humanLike: { type: 'boolean', default: true, description: 'Human-like typing with random delays' },
        aiMatch: { type: 'boolean', default: true, description: 'AI matches fields even if names differ' },
        analyzeFirst: { type: 'boolean', default: true, description: 'Analyze page structure before solving' }
      }
    }
  },

  // 9. Random Scroll
  {
    name: 'random_scroll',
    emoji: '📜',
    description: 'Human-like scroll with AI pattern detection',
    descriptionHindi: 'स्क्रॉल करना (human-like + AI)',
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



  // 12. Redirect Tracer
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
        decodeURLs: { type: 'boolean', default: true, description: 'Auto-decode encoded URLs in chain' }
      },
      required: ['url']
    }
  },

  // 13. Extract Data (MERGED: search_regex + extract_json + scrape_meta_tags + link_harvester + POWER FEATURES)
  {
    name: 'extract_data',
    emoji: '🔎',
    description: 'Universal data extractor with 9 modes: (1) regex, (2) json, (3) meta, (4) structured, (5) auto, (6) deobfuscate, (7) apiDiscovery, (8) decrypt, (9) links - extract all links including hidden, iframe, and obfuscated links.\n\n🤖 AI Usage Guide: Use this INSTEAD of executing custom JS (`execute_js`) to scrape data. If you need links, use type="links". For general info, use type="auto".',
    descriptionHindi: 'यूनिवर्सल डेटा एक्सट्रैक्टर — 9 modes: regex, json, meta, structured, auto, deobfuscate, apiDiscovery, decrypt, links (extract all links)।',
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
        autoFindKey: { type: 'boolean', default: true, description: 'For decrypt: auto-extract AES keys from page scripts' },
        aesKey: { type: 'string', description: 'For decrypt: AES decryption key' },
        aesIV: { type: 'string', description: 'For decrypt: AES initialization vector' },
        includeHidden: { type: 'boolean', default: true, description: 'For links: Include hidden links' },
        searchIframes: { type: 'boolean', default: true, description: 'For links: Search inside iframes' }
      }
    }
  },

  // 14. Press Key
  {
    name: 'press_key',
    emoji: '🎹',
    description: 'Press keyboard keys with human-like timing',
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

  // 15. Progress Tracker
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
        action: { type: 'string', enum: ['start', 'update', 'complete', 'get'], default: 'get' },
        taskName: { type: 'string' },
        progress: { type: 'number', description: '0-100' },
        aiEstimate: { type: 'boolean', default: true, description: 'AI estimates remaining time' }
      }
    }
  },

  // 16. Deep Analysis
  {
    name: 'deep_analysis',
    emoji: '🧠',
    description: 'Deep page analysis: DOM structure, scripts, styles, accessibility, performance metrics, SEO tags, security headers, anti-bot detection (Cloudflare, DataDome, reCAPTCHA), technology stack identification, and AI-powered recommendations for scraping strategy.\n\n🤖 AI Usage Guide: Use this if you are getting blocked or if elements are mysteriously absent, to check for anti-bot measures or iFrames.',
    descriptionHindi: 'गहरा पेज विश्लेषण — DOM, scripts, anti-bot detection, tech stack, SEO, AI recommendations।',
    category: 'analysis',
    requiresBrowser: true,
    requiresPage: true,
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, default: ['all'] },
        detailed: { type: 'boolean', default: true },
        aiInsights: { type: 'boolean', default: true, description: 'AI provides recommendations' },
        detectAntiBot: { type: 'boolean', default: true, description: 'Detect anti-bot measures' }
      }
    }
  },

  // 17. Network Recorder (POWER ENHANCED)
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



  // 21. Media Extractor (MERGED: iframe_handler + stream_extractor + player_api_hook)
  {
    name: 'media_extractor',
    emoji: '🎬',
    description: 'Universal media extractor with 6 actions: (1) extract - find all video/audio/HLS/DASH/download URLs from page + nested iframes (3+ levels deep), (2) list_iframes - list all iframes with indices, (3) switch_iframe - get iframe URL and info (use iframe/iframeSelector params on other tools to target specific iframes), (4) player_control - control video players (JWPlayer, VideoJS, Plyr, VidStack, DooPlayer) via API: play/pause/seek/sources, (5) decode_url - decode obfuscated URLs: auto/url/base64/aes with key+IV, (6) batch_extract - extract from multiple URLs at once.',
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

  // 22. Execute JS (ENHANCED: iframe context fix)
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


  // 23. Storage Inspector
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

  // 24. Replay Request
  {
    name: 'replay_request',
    emoji: '🔁',
    description: 'Replay a captured API request directly in the browser context (bypasses CORS, attaches auth/cookies).',
    descriptionHindi: 'कैप्चर की गई रिक्वेस्ट को फिर से ब्राउज़र में भेजना।',
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

  // 24b. API Analyzer
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

  // 25. See Page (AI Vision — "eyes")
  {
    name: 'see_page',
    emoji: '👁️',
    description: 'AI VISION ("eyes"): Visually SEE the current page exactly like a human does. Captures a screenshot and returns the actual image to the AI agent so it can visually understand the layout, AND returns a "visual map" of all visible interactive elements (buttons, links, inputs) with their on-screen position (x/y/width/height), text label, and a click-ready selector. Use this to look at a page before deciding where to click/type.\n\n🤖 AI Usage Guide: PREFER a single FULL-PAGE view (set fullPage: true) so the whole page and all its interactive elements are mapped in one shot, then plan and perform ALL needed actions for that page (read, click, type, extract) from this single view. Call see_page a SECOND time ONLY IF the task genuinely cannot be completed from the first view, OR after the page actually changes — navigation, a modal/popup opens, or new dynamic content loads. Do NOT re-capture the SAME unchanged page repeatedly.',
    descriptionHindi: 'AI विज़न ("आँखें"): पेज को इंसान की तरह देखना। स्क्रीनशॉट image सीधे AI को भेजता है ताकि वह layout देख सके + सभी दिखने वाले clickable elements का visual map (position + text + selector) देता है। नियम: पहले पूरे पेज का full-page view लें (fullPage: true) ताकि पूरा पेज और उसके सारे elements एक ही बार में map हो जाएँ, फिर उसी एक view से उस पेज के सारे ज़रूरी काम (पढ़ना, क्लिक, टाइप, data निकालना) एक साथ पूरे करें। दूसरी बार see_page सिर्फ़ तभी लें जब पहले view से काम पूरा न हो पाए, या पेज सच में बदल जाए (navigation, modal/popup खुले, या नया dynamic content load हो)। बिना बदलाव के उसी पेज का दोबारा स्क्रीनशॉट न लें।',
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
        maxElements: { type: 'number', default: 60, description: 'Max number of interactive elements to map' },
        path: { type: 'string', description: 'Optional file path to also save the captured image' },
        autoHover: { type: 'boolean', default: false, description: 'Hover over menus before taking screenshot to reveal dropdowns' },
        watchMutations: { type: 'boolean', default: false, description: 'Check for DOM mutations (popups/alerts) since last view' }
      }
    }
  }
];

// Tool categories
const CATEGORIES = {
  browser: { name: 'Browser', emoji: '🌐', description: 'Browser lifecycle management' },
  navigation: { name: 'Navigation', emoji: '🧭', description: 'Page navigation' },
  interaction: { name: 'Interaction', emoji: '👆', description: 'User interactions' },
  extraction: { name: 'Extraction', emoji: '📄', description: 'Content extraction and scraping' },
  network: { name: 'Network', emoji: '📡', description: 'Network operations' },
  analysis: { name: 'Analysis', emoji: '🧠', description: 'Page analysis' },

  vision: { name: 'Vision', emoji: '👁️', description: 'AI visual perception (sees pages like human eyes)' },
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

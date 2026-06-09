// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil } from './state';
import { handlers } from './index';

// Auto-generated misc handlers

export const miscHandlers = {
  _validateCaptchaText(text, expectedLength, allowedChars) {
    if (!text || text.trim() === '') return { valid: false, reason: 'Empty text' };
    if (expectedLength && text.length !== expectedLength) {
      return { valid: false, reason: `Expected ${expectedLength} chars, got ${text.length}` };
    }
    if (allowedChars) {
      const regex = new RegExp('^[' + allowedChars + ']+$');
      if (!regex.test(text)) return { valid: false, reason: 'Contains chars outside allowed set: ' + allowedChars };
    }
    return { valid: true };
  },

  async search_regex(params) {
    const { page } = requireBrowser();
    const { pattern, flags = 'gi', source = 'html' } = params;

    notifyProgress('search_regex', 'started', `Searching pattern: ${pattern}`);

    let content;
    if (source === 'html') {
      content = await page.content();
    } else if (source === 'scripts') {
      content = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
    } else {
      content = await page.evaluate(() => document.body.innerText);
    }

    const regex = new RegExp(pattern, flags);
    const matches = content.match(regex) || [];

    notifyProgress('search_regex', 'completed', `Found ${matches.length} matches`, { matchCount: matches.length });

    return { success: true, pattern, matchCount: matches.length, matches: matches.slice(0, 100) };
  },

  async progress_tracker(params = {}) {
    const { action = 'get', taskName, progress } = params;

    switch (action) {
      case 'start':
        state.progressTasks[taskName] = { progress: 0, startTime: Date.now() };
        notifyProgress('progress_tracker', 'started', `Task started: ${taskName}`);
        break;
      case 'update':
        if (state.progressTasks[taskName]) {
          state.progressTasks[taskName].progress = progress;
          notifyProgress('progress_tracker', 'progress', `${taskName}: ${progress}%`, { taskName, progress });
        }
        break;
      case 'complete':
        if (state.progressTasks[taskName]) {
          state.progressTasks[taskName].progress = 100;
          state.progressTasks[taskName].endTime = Date.now();
          const duration = state.progressTasks[taskName].endTime - state.progressTasks[taskName].startTime;
          notifyProgress('progress_tracker', 'completed', `${taskName} completed in ${duration}ms`, { taskName, duration });
        }
        break;
    }

    return { success: true, tasks: state.progressTasks };
  },

  async deep_analysis(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], detailed = true } = params;

    notifyProgress('deep_analysis', 'started', 'Analyzing page...');

    const analysis = await page.evaluate(() => {
      const result = {
        seo: {
          title: document.title,
          titleLength: document.title.length,
          h1Count: document.querySelectorAll('h1').length,
          metaDescription: document.querySelector('meta[name="description"]')?.content,
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
      return result;
    });

    notifyProgress('deep_analysis', 'completed', `Analysis complete: ${analysis.performance.domElements} DOM elements`, { domElements: analysis.performance.domElements });

    return { success: true, url: page.url(), analysis };
  },

  async file_downloader(params) {
    const { page } = requireBrowser();
    const { url, filename, directory = './downloads' } = params;

    notifyProgress('file_downloader', 'started', `Downloading: ${url}`);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const response = await page.goto(url, { waitUntil: 'networkidle' });
    const buffer = await response.body();

    const outputFilename = filename || path.basename(new URL(url).pathname) || 'download';
    const outputPath = path.join(directory, outputFilename);

    fs.writeFileSync(outputPath, buffer);

    notifyProgress('file_downloader', 'completed', `Downloaded: ${outputFilename} (${buffer.length} bytes)`, { filename: outputPath, size: buffer.length });

    return { success: true, filename: outputPath, size: buffer.length };
  },

  async iframe_handler(params = {}) {
    const { page } = requireBrowser();
    const { action = 'list', selector, index } = params;

    notifyProgress('iframe_handler', 'started', `iFrame action: ${action}`);

    const frames = page.frames();

    switch (action) {
      case 'list':
        notifyProgress('iframe_handler', 'completed', `Found ${frames.length} frames`);
        return {
          success: true,
          count: frames.length,
          frames: frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }))
        };

      case 'switch':
        const targetFrame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index];

        if (targetFrame) {
          notifyProgress('iframe_handler', 'completed', `Switched to frame: ${targetFrame.url()}`);
          return { success: true, switched: true, url: targetFrame.url() };
        }
        notifyProgress('iframe_handler', 'error', 'Frame not found');
        return { success: false, error: 'Frame not found' };

      case 'content':
        const frame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index || 0];

        if (frame) {
          const content = await frame.content();
          notifyProgress('iframe_handler', 'completed', `Got frame content: ${content.length} chars`);
          return { success: true, content };
        }
        return { success: false, error: 'Frame not found' };

      case 'exit':
        notifyProgress('iframe_handler', 'completed', 'Returned to main frame');
        return { success: true, message: 'Returned to main frame' };
    }

    return { success: false, error: 'Invalid action' };
  },

  async stream_extractor(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], quality = 'best', searchIframes = true, deep = true } = params;

    notifyProgress('stream_extractor', 'started', 'Extracting streams (enhanced mode)...');

    // Helper function to extract streams from a frame/page context
    const extractFromContext = async (context, contextName = 'main') => {
      return await context.evaluate(() => {
        const result = { video: [], audio: [], hls: [], dash: [], download: [], embedded: [] };

        // 1. Direct video/audio elements
        document.querySelectorAll('video source, video').forEach(el => {
          const src = el.src || el.getAttribute('src') || el.currentSrc;
          if (src && src.startsWith('http')) result.video.push({ src, type: el.type || 'video' });
        });

        document.querySelectorAll('audio source, audio').forEach(el => {
          const src = el.src || el.getAttribute('src');
          if (src && src.startsWith('http')) result.audio.push({ src, type: el.type || 'audio' });
        });

        // 2. Script content analysis for HLS/DASH/MP4
        const scripts = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
        const html = document.documentElement.innerHTML;
        const combined = scripts + html;

        // HLS streams
        const hlsMatches = combined.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
        result.hls = [...new Set(hlsMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'hls' }));

        // DASH streams
        const dashMatches = combined.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/gi) || [];
        result.dash = [...new Set(dashMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'dash' }));

        // Direct MP4/video links
        const mp4Matches = combined.match(/https?:\/\/[^\s"'<>]+\.(mp4|mkv|avi|webm)[^\s"'<>]*/gi) || [];
        result.download = [...new Set(mp4Matches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'direct' }));

        // 3. Data attributes and hidden sources
        document.querySelectorAll('[data-src], [data-video], [data-url], [data-file]').forEach(el => {
          const dataSrc = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.file;
          if (dataSrc && dataSrc.startsWith('http')) {
            result.video.push({ src: dataSrc, type: 'data-attribute' });
          }
        });

        // 4. Embedded player iframes (just URLs, not content)
        document.querySelectorAll('iframe[src]').forEach(el => {
          const src = el.src;
          if (src && src.startsWith('http')) {
            result.embedded.push({ src, type: 'iframe' });
          }
        });

        // 5. JWPlayer / VideoJS / Plyr sources
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            const playlist = jw.getPlaylist?.() || [];
            playlist.forEach(item => {
              if (item.file) result.video.push({ src: item.file, type: 'jwplayer' });
              (item.sources || []).forEach(s => {
                if (s.file) result.video.push({ src: s.file, type: 'jwplayer-source' });
              });
            });
          } catch (e) { }
        }

        if (window.player && window.player.src) {
          try {
            const src = typeof window.player.src === 'function' ? window.player.src() : window.player.src;
            if (src) result.video.push({ src, type: 'player-api' });
          } catch (e) { }
        }

        // 6. Look for common piracy site patterns
        const patterns = [
          /file\s*:\s*["']([^"']+)["']/gi,
          /source\s*:\s*["']([^"']+)["']/gi,
          /src\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv))["']/gi,
          /url\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/gi,
          /video_url\s*=\s*["']([^"']+)["']/gi,
          /sources\s*:\s*\[([^\]]+)\]/gi
        ];

        patterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(combined)) !== null) {
            const url = match[1];
            if (url && url.startsWith('http') && (url.includes('.mp4') || url.includes('.m3u8'))) {
              result.download.push({ src: url, type: 'pattern-match' });
            }
          }
        });

        return result;
      }).catch(() => ({ video: [], audio: [], hls: [], dash: [], download: [], embedded: [] }));
    };

    // Extract from main page
    const mainStreams = await extractFromContext(page, 'main');
    let allStreams = { ...mainStreams };

    // Search in iframes if enabled
    if (searchIframes) {
      const frames = page.frames();
      notifyProgress('stream_extractor', 'progress', `Searching ${frames.length} frames...`);

      for (let i = 1; i < frames.length && i < 10; i++) { // Limit to 10 frames
        try {
          const frame = frames[i];
          const frameUrl = frame.url();
          if (frameUrl && frameUrl !== 'about:blank') {
            const frameStreams = await extractFromContext(frame, `frame-${i}`);

            // Merge frame streams
            Object.keys(frameStreams).forEach(key => {
              if (Array.isArray(frameStreams[key])) {
                frameStreams[key].forEach(stream => {
                  stream.source = `iframe: ${frameUrl}`;
                });
                allStreams[key] = [...(allStreams[key] || []), ...frameStreams[key]];
              }
            });
          }
        } catch (e) {
          // Frame access error, skip
        }
      }
    }

    // Deduplicate by URL
    Object.keys(allStreams).forEach(key => {
      if (Array.isArray(allStreams[key])) {
        const seen = new Set();
        allStreams[key] = allStreams[key].filter(item => {
          if (seen.has(item.src)) return false;
          seen.add(item.src);
          return true;
        });
      }
    });

    const totalStreams = Object.values(allStreams).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    notifyProgress('stream_extractor', 'completed', `Found ${totalStreams} streams (including iframes)`, { totalStreams });

    return { success: true, streams: allStreams, totalCount: totalStreams };
  },

  async js_scrape(params) {
    const { page } = requireBrowser();
    const { selector, waitForJS = true, timeout = 10000 } = params;

    notifyProgress('js_scrape', 'started', `Scraping: ${selector}`);

    if (waitForJS) {
      await page.waitForSelector(selector, { timeout });
      notifyProgress('js_scrape', 'progress', 'Element found, extracting content...');
    }

    const content = await page.$eval(selector, el => ({
      html: el.outerHTML,
      text: el.innerText,
      attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value]))
    }));

    notifyProgress('js_scrape', 'completed', `Scraped ${content.text.length} characters`, { selector });

    return { success: true, selector, content };
  },

  async execute_js(params) {
    const { page } = requireBrowser();
    const {
      code,
      returnValue = true,
      // NEW: iframe support (FIXED)
      iframe,
      iframeSelector,
      waitForIframe = true,
      timeout = 30000
    } = params;

    notifyProgress('execute_js', 'started', `Executing JavaScript...${iframe !== undefined ? ` (iframe ${iframe})` : ''}`);

    // Get the correct context (page or iframe)
    let context = page;
    let frameInfo = null;

    if (iframe !== undefined || iframeSelector) {
      try {
        const frames = page.frames();

        if (iframe !== undefined) {
          // iframe index provided
          if (iframe === 0) {
            // index 0 = main frame
            context = page.mainFrame();
            frameInfo = { index: 0, url: page.url(), isMain: true };
          } else if (frames[iframe]) {
            context = frames[iframe];
            frameInfo = { index: iframe, url: frames[iframe].url() };
            notifyProgress('execute_js', 'progress', `Switched to iframe ${iframe}: ${frames[iframe].url().substring(0, 50)}...`);
          } else {
            notifyProgress('execute_js', 'error', `iframe index ${iframe} not found. Total frames: ${frames.length}`);
            return { success: false, error: `iframe index ${iframe} not found. Available: 0-${frames.length - 1}` };
          }
        } else if (iframeSelector) {
          // Find iframe by selector
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame;
              frameInfo = { selector: iframeSelector, url: frame.url() };
              notifyProgress('execute_js', 'progress', `Switched to iframe by selector: ${iframeSelector}`);
            }
          } else {
            return { success: false, error: `iframe selector not found: ${iframeSelector}` };
          }
        }

        // Wait for iframe to be ready if needed
        if (waitForIframe && context !== page) {
          try {
            await context.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
          } catch (e) {
            notifyProgress('execute_js', 'progress', 'Warning: iframe may not be fully loaded');
          }
        }

      } catch (e) {
        notifyProgress('execute_js', 'error', `iframe switch failed: ${e.message}`);
        return { success: false, error: `iframe switch failed: ${e.message}` };
      }
    }

    try {
      // Execute the code in the correct context
      const result = await context.evaluate(code);

      notifyProgress('execute_js', 'completed', 'JavaScript executed', {
        hasResult: result !== undefined,
        iframe: frameInfo
      });

      return { success: true, result: returnValue ? result : undefined, iframe: frameInfo };

    } catch (evalError) {
      notifyProgress('execute_js', 'error', `Execution error: ${evalError.message}`);
      return { success: false, error: evalError.message, iframe: frameInfo };
    }
  },

  async player_api_hook(params = {}) {
    const { page } = requireBrowser();
    const { playerType = 'auto', action = 'info', searchIframes = true } = params;

    notifyProgress('player_api_hook', 'started', `Player ${action}: ${playerType}`);

    // Enhanced player detection function
    const detectPlayer = async (context, contextName = 'main') => {
      return await context.evaluate(({ playerType, action }) => {
        const result = {
          detected: false,
          type: null,
          sources: [],
          info: {}
        };

        // 1. JWPlayer detection
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            if (jw) {
              result.detected = true;
              result.type = 'jwplayer';
              result.info = {
                duration: jw.getDuration?.(),
                currentTime: jw.getPosition?.(),
                volume: jw.getVolume?.(),
                state: jw.getState?.()
              };

              if (action === 'sources') {
                const playlist = jw.getPlaylist?.() || [];
                playlist.forEach(item => {
                  if (item.file) result.sources.push({ src: item.file, type: 'jwplayer' });
                  (item.sources || []).forEach(s => {
                    if (s.file) result.sources.push({ src: s.file, type: 'jwplayer-source', label: s.label });
                  });
                });
              }

              if (action === 'play') jw.play?.();
              if (action === 'pause') jw.pause?.();
            }
          } catch (e) { }
        }

        // 2. Video.js detection
        if (window.videojs && !result.detected) {
          try {
            const players = document.querySelectorAll('.video-js');
            if (players.length > 0) {
              const player = window.videojs(players[0].id || players[0]);
              result.detected = true;
              result.type = 'videojs';
              result.info = {
                duration: player.duration?.(),
                currentTime: player.currentTime?.(),
                volume: player.volume?.()
              };

              if (action === 'sources') {
                const src = player.currentSrc?.();
                if (src) result.sources.push({ src, type: 'videojs' });
              }

              if (action === 'play') player.play?.();
              if (action === 'pause') player.pause?.();
            }
          } catch (e) { }
        }

        // 3. Plyr detection
        if (window.Plyr && !result.detected) {
          try {
            const plyrElements = document.querySelectorAll('.plyr');
            if (plyrElements.length > 0 && plyrElements[0].plyr) {
              const player = plyrElements[0].plyr;
              result.detected = true;
              result.type = 'plyr';
              result.info = {
                duration: player.duration,
                currentTime: player.currentTime,
                volume: player.volume
              };

              if (action === 'sources') {
                const src = player.source;
                if (src) result.sources.push({ src, type: 'plyr' });
              }
            }
          } catch (e) { }
        }

        // 4. Generic window.player
        if ((window.player || window.videoPlayer) && !result.detected) {
          try {
            const player = window.player || window.videoPlayer;
            result.detected = true;
            result.type = 'generic';
            result.info = {
              duration: player.getDuration?.() || player.duration,
              currentTime: player.getCurrentTime?.() || player.currentTime,
              volume: player.getVolume?.() || player.volume
            };

            if (action === 'sources') {
              const sources = player.getSources?.() || player.getPlaylist?.() || [];
              sources.forEach(s => {
                if (s.file || s.src) result.sources.push({ src: s.file || s.src, type: 'generic' });
              });
            }
          } catch (e) { }
        }

        // 5. HTML5 Video fallback
        if (!result.detected) {
          const video = document.querySelector('video');
          if (video) {
            result.detected = true;
            result.type = 'html5';
            result.info = {
              duration: video.duration,
              currentTime: video.currentTime,
              volume: video.volume,
              paused: video.paused,
              src: video.src || video.currentSrc
            };

            if (action === 'sources') {
              if (video.src) result.sources.push({ src: video.src, type: 'html5' });
              if (video.currentSrc && video.currentSrc !== video.src) {
                result.sources.push({ src: video.currentSrc, type: 'html5-current' });
              }
              video.querySelectorAll('source').forEach(s => {
                if (s.src) result.sources.push({ src: s.src, type: 'html5-source' });
              });
            }

            if (action === 'play') video.play();
            if (action === 'pause') video.pause();
          }
        }

        // 6. Look for common obfuscated player variables
        const commonPlayerVars = ['player', 'videoPlayer', 'mediaPlayer', 'vPlayer', 'hls', 'flv'];
        for (const varName of commonPlayerVars) {
          if (window[varName] && !result.detected) {
            try {
              const p = window[varName];
              if (typeof p === 'object' && (p.play || p.getDuration || p.src)) {
                result.detected = true;
                result.type = `${varName}-object`;
                result.info = { raw: true };
              }
            } catch (e) { }
          }
        }

        return result;
      }, { playerType, action }).catch(() => ({ detected: false }));
    };

    // Try main page first
    let playerInfo = await detectPlayer(page, 'main');

    // Search iframes if no player found and searchIframes is enabled
    if (!playerInfo.detected && searchIframes) {
      const frames = page.frames();
      notifyProgress('player_api_hook', 'progress', `Searching ${frames.length} frames for player...`);

      for (let i = 1; i < frames.length && i < 10; i++) {
        try {
          const frame = frames[i];
          const frameUrl = frame.url();
          if (frameUrl && frameUrl !== 'about:blank') {
            const framePlayer = await detectPlayer(frame, `frame-${i}`);
            if (framePlayer.detected) {
              playerInfo = { ...framePlayer, frameSource: frameUrl };
              notifyProgress('player_api_hook', 'progress', `Found player in iframe: ${frameUrl}`);
              break;
            }
          }
        } catch (e) {
          // Frame access error, skip
        }
      }
    }

    notifyProgress('player_api_hook', 'completed',
      playerInfo.detected ? `Player detected: ${playerInfo.type}${playerInfo.frameSource ? ' (in iframe)' : ''}` : 'No player found',
      { detected: playerInfo.detected, type: playerInfo.type });

    return { success: true, ...playerInfo };
  },

  async form_automator(params) {
    const { page } = requireBrowser();
    const { selector, data, submit = false, humanLike = true } = params;

    const formSelector = selector || 'form';
    const fields = Object.keys(data || {});

    notifyProgress('form_automator', 'started', `Filling form with ${fields.length} fields`);

    let filledCount = 0;

    for (const [field, value] of Object.entries(data || {})) {
      const inputSelector = `${formSelector} [name="${field}"], ${formSelector} #${field}, ${formSelector} [placeholder*="${field}" i]`;

      try {
        const input = await page.$(inputSelector);
        if (input) {
          const tagName = await input.evaluate(el => el.tagName.toLowerCase());
          const inputType = await input.evaluate(el => el.type);

          if (tagName === 'select') {
            await page.selectOption(inputSelector, value);
          } else if (inputType === 'checkbox' || inputType === 'radio') {
            if (value) await input.click();
          } else {
            await input.click({ clickCount: 3 });
            if (humanLike) {
              await page.type(inputSelector, String(value), { delay: 50 + Math.random() * 50 });
            } else {
              await page.type(inputSelector, String(value));
            }
          }
          filledCount++;
          notifyProgress('form_automator', 'progress', `Filled: ${field}`, { field, filledCount });
        }
      } catch (e) {
        // Field not found, continue
      }
    }

    if (submit) {
      await page.click(`${formSelector} [type="submit"], ${formSelector} button`);
      notifyProgress('form_automator', 'progress', 'Form submitted');
    }

    notifyProgress('form_automator', 'completed', `Filled ${filledCount}/${fields.length} fields`, { filledCount, submitted: submit });

    return { success: true, formSelector, fieldsProcessed: filledCount, submitted: submit };
  },

  async media_extractor(params = {}) {
    const { page } = requireBrowser();
    const {
      action = 'extract',
      types = ['all'],
      quality = 'best',
      searchIframes = true,
      deep = true,
      selector,
      index,
      playerAction = 'info',
      encodedData,
      decoderType = 'auto',
      aesKey,
      aesIV,
      urls,
      aiOptimize = true
    } = params;

    notifyProgress('media_extractor', 'started', `Media extraction action: ${action}`);

    // Helper: Extract streams from a context
    const extractStreamsFromContext = async (context, contextName = 'main') => {
      return await context.evaluate(() => {
        const result = { video: [], audio: [], hls: [], dash: [], download: [], embedded: [] };

        // 1. Direct video/audio elements
        document.querySelectorAll('video source, video').forEach(el => {
          const src = el.src || el.getAttribute('src') || el.currentSrc;
          if (src && src.startsWith('http')) result.video.push({ src, type: el.type || 'video' });
        });

        document.querySelectorAll('audio source, audio').forEach(el => {
          const src = el.src || el.getAttribute('src');
          if (src && src.startsWith('http')) result.audio.push({ src, type: el.type || 'audio' });
        });

        // 2. Script content analysis for HLS/DASH/MP4
        const scripts = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
        const html = document.documentElement.innerHTML;
        const combined = scripts + html;

        // HLS streams
        const hlsMatches = combined.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
        result.hls = [...new Set(hlsMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'hls' }));

        // DASH streams
        const dashMatches = combined.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/gi) || [];
        result.dash = [...new Set(dashMatches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'dash' }));

        // Direct MP4/video links
        const mp4Matches = combined.match(/https?:\/\/[^\s"'<>]+\.(mp4|mkv|avi|webm)[^\s"'<>]*/gi) || [];
        result.download = [...new Set(mp4Matches)].map(src => ({ src: src.replace(/\\"/g, ''), type: 'direct' }));

        // 3. Data attributes and hidden sources
        document.querySelectorAll('[data-src], [data-video], [data-url], [data-file]').forEach(el => {
          const dataSrc = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.file;
          if (dataSrc && dataSrc.startsWith('http')) {
            result.video.push({ src: dataSrc, type: 'data-attribute' });
          }
        });

        // 4. Embedded player iframes
        document.querySelectorAll('iframe[src]').forEach(el => {
          const src = el.src;
          if (src && src.startsWith('http')) {
            result.embedded.push({ src, type: 'iframe' });
          }
        });

        // 5. JWPlayer / VideoJS / Plyr sources
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            const playlist = jw.getPlaylist?.() || [];
            playlist.forEach(item => {
              if (item.file) result.video.push({ src: item.file, type: 'jwplayer' });
              (item.sources || []).forEach(s => {
                if (s.file) result.video.push({ src: s.file, type: 'jwplayer-source' });
              });
            });
          } catch (e) { }
        }

        if (window.player && window.player.src) {
          try {
            const src = typeof window.player.src === 'function' ? window.player.src() : window.player.src;
            if (src) result.video.push({ src, type: 'player-api' });
          } catch (e) { }
        }

        // 6. Look for common patterns
        const patterns = [
          /file\s*:\s*["']([^"']+)["']/gi,
          /source\s*:\s*["']([^"']+)["']/gi,
          /src\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv))["']/gi,
          /url\s*:\s*["']([^"']+\.(?:m3u8|mp4))["']/gi,
          /video_url\s*=\s*["']([^"']+)["']/gi,
          /sources\s*:\s*\[([^\]]+)\]/gi
        ];

        patterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(combined)) !== null) {
            const url = match[1];
            if (url && url.startsWith('http') && (url.includes('.mp4') || url.includes('.m3u8'))) {
              result.download.push({ src: url, type: 'pattern-match' });
            }
          }
        });

        return result;
      }).catch(() => ({ video: [], audio: [], hls: [], dash: [], download: [], embedded: [] }));
    };

    // Helper: Detect player in context
    const detectPlayer = async (context, contextName = 'main') => {
      return await context.evaluate((playerAction) => {
        const result = { detected: false, type: null, sources: [], info: {} };

        // 1. JWPlayer detection
        if (window.jwplayer) {
          try {
            const jw = window.jwplayer();
            if (jw) {
              result.detected = true;
              result.type = 'jwplayer';
              result.info = {
                duration: jw.getDuration?.(),
                currentTime: jw.getPosition?.(),
                volume: jw.getVolume?.(),
                state: jw.getState?.()
              };

              if (playerAction === 'sources') {
                const playlist = jw.getPlaylist?.() || [];
                playlist.forEach(item => {
                  if (item.file) result.sources.push({ src: item.file, type: 'jwplayer' });
                  (item.sources || []).forEach(s => {
                    if (s.file) result.sources.push({ src: s.file, type: 'jwplayer-source', label: s.label });
                  });
                });
              }

              if (playerAction === 'play') jw.play?.();
              if (playerAction === 'pause') jw.pause?.();
              if (playerAction === 'seek' && params.seekTime) jw.seek?.(params.seekTime);
            }
          } catch (e) { }
        }

        // 2. Video.js detection
        if (window.videojs && !result.detected) {
          try {
            const players = document.querySelectorAll('.video-js');
            if (players.length > 0) {
              const player = window.videojs(players[0].id || players[0]);
              result.detected = true;
              result.type = 'videojs';
              result.info = { duration: player.duration?.(), currentTime: player.currentTime?.(), volume: player.volume?.() };

              if (playerAction === 'sources') {
                const src = player.currentSrc?.();
                if (src) result.sources.push({ src, type: 'videojs' });
              }

              if (playerAction === 'play') player.play?.();
              if (playerAction === 'pause') player.pause?.();
              if (playerAction === 'seek' && params.seekTime) player.currentTime?.(params.seekTime);
            }
          } catch (e) { }
        }

        // 3. Plyr detection
        if (window.Plyr && !result.detected) {
          try {
            const plyrElements = document.querySelectorAll('.plyr');
            if (plyrElements.length > 0 && plyrElements[0].plyr) {
              const player = plyrElements[0].plyr;
              result.detected = true;
              result.type = 'plyr';
              result.info = { duration: player.duration, currentTime: player.currentTime, volume: player.volume };

              if (playerAction === 'sources') {
                const src = player.source;
                if (src) result.sources.push({ src, type: 'plyr' });
              }

              if (playerAction === 'play') player.play?.();
              if (playerAction === 'pause') player.pause?.();
            }
          } catch (e) { }
        }

        // 4. Generic window.player
        if ((window.player || window.videoPlayer) && !result.detected) {
          try {
            const player = window.player || window.videoPlayer;
            result.detected = true;
            result.type = 'generic';
            result.info = {
              duration: player.getDuration?.() || player.duration,
              currentTime: player.getCurrentTime?.() || player.currentTime,
              volume: player.getVolume?.() || player.volume
            };

            if (playerAction === 'sources') {
              const sources = player.getSources?.() || player.getPlaylist?.() || [];
              sources.forEach(s => {
                if (s.file || s.src) result.sources.push({ src: s.file || s.src, type: 'generic' });
              });
            }
          } catch (e) { }
        }

        // 5. HTML5 Video fallback
        if (!result.detected) {
          const video = document.querySelector('video');
          if (video) {
            result.detected = true;
            result.type = 'html5';
            result.info = { duration: video.duration, currentTime: video.currentTime, volume: video.volume, paused: video.paused, src: video.src || video.currentSrc };

            if (playerAction === 'sources') {
              if (video.src) result.sources.push({ src: video.src, type: 'html5' });
              video.querySelectorAll('source').forEach(s => { if (s.src) result.sources.push({ src: s.src, type: 'html5-source' }); });
            }

            if (playerAction === 'play') video.play();
            if (playerAction === 'pause') video.pause();
            if (playerAction === 'seek' && params.seekTime) video.currentTime = params.seekTime;
          }
        }

        return result;
      }, playerAction).catch(() => ({ detected: false }));
    };

    // Helper: Deduplicate streams
    const deduplicateStreams = (streams) => {
      Object.keys(streams).forEach(key => {
        if (Array.isArray(streams[key])) {
          const seen = new Set();
          streams[key] = streams[key].filter(item => {
            if (seen.has(item.src)) return false;
            seen.add(item.src);
            return true;
          });
        }
      });
      return streams;
    };

    // Helper: Auto-detect decoder type
    const autoDetectDecoder = (data) => {
      if (data.includes('%')) return 'url';
      if (/^[A-Za-z0-9+/=]+$/.test(data) && data.length % 4 === 0) return 'base64';
      return 'url';
    };

    switch (action) {
      case 'extract': {
        // Comprehensive extraction - streams, iframes, and players
        notifyProgress('media_extractor', 'progress', 'Extracting all media...');

        // Get iframes
        const frames = page.frames();
        const iframes = frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }));

        // Extract streams from main page
        let allStreams = await extractStreamsFromContext(page, 'main');

        // Search in iframes
        if (searchIframes) {
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const frameStreams = await extractStreamsFromContext(frame, `frame-${i}`);
                Object.keys(frameStreams).forEach(key => {
                  if (Array.isArray(frameStreams[key])) {
                    frameStreams[key].forEach(stream => { stream.source = `iframe: ${frameUrl}`; });
                    allStreams[key] = [...(allStreams[key] || []), ...frameStreams[key]];
                  }
                });
              }
            } catch (e) { }
          }
        }

        // Deduplicate
        allStreams = deduplicateStreams(allStreams);

        // Detect players
        let playerInfo = await detectPlayer(page, 'main');
        if (!playerInfo.detected && searchIframes) {
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const framePlayer = await detectPlayer(frame, `frame-${i}`);
                if (framePlayer.detected) {
                  playerInfo = { ...framePlayer, frameSource: frameUrl };
                  break;
                }
              }
            } catch (e) { }
          }
        }

        const totalStreams = Object.values(allStreams).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        notifyProgress('media_extractor', 'completed', `Extracted ${totalStreams} streams, ${iframes.length} iframes, player: ${playerInfo.detected ? playerInfo.type : 'none'}`);

        return {
          success: true,
          action: 'extract',
          streams: allStreams,
          iframes,
          player: playerInfo,
          totalStreams,
          iframeCount: iframes.length
        };
      }

      case 'list_iframes': {
        const frames = page.frames();
        const iframes = frames.map((f, i) => ({ index: i, name: f.name(), url: f.url() }));
        notifyProgress('media_extractor', 'completed', `Found ${iframes.length} iframes`);
        return { success: true, action: 'list_iframes', count: iframes.length, iframes };
      }

      case 'switch_iframe': {
        const frames = page.frames();
        const targetFrame = selector
          ? await page.$(selector).then(el => el?.contentFrame())
          : frames[index];

        if (targetFrame) {
          notifyProgress('media_extractor', 'completed', `Switched to iframe: ${targetFrame.url()}`);
          return { success: true, action: 'switch_iframe', switched: true, url: targetFrame.url(), frameIndex: index };
        }
        notifyProgress('media_extractor', 'error', 'Iframe not found');
        return { success: false, error: 'Iframe not found' };
      }

      case 'player_control': {
        const { playerType, seekTime, volume } = params;
        notifyProgress('media_extractor', 'progress', `Player control: ${playerAction}`);

        // Try main page first
        let result = await detectPlayer(page, 'main');

        // Search iframes if no player found
        if (!result.detected && searchIframes) {
          const frames = page.frames();
          for (let i = 1; i < frames.length && i < 10; i++) {
            try {
              const frame = frames[i];
              const frameUrl = frame.url();
              if (frameUrl && frameUrl !== 'about:blank') {
                const frameResult = await detectPlayer(frame, `frame-${i}`);
                if (frameResult.detected) {
                  result = { ...frameResult, frameSource: frameUrl };
                  break;
                }
              }
            } catch (e) { }
          }
        }

        notifyProgress('media_extractor', 'completed', result.detected ? `Player ${playerAction} executed: ${result.type}` : 'No player found');
        return { success: true, action: 'player_control', playerAction, ...result };
      }

      case 'decode_url': {
        if (!encodedData) {
          return { success: false, error: 'encodedData is required for decode_url action' };
        }

        const type = decoderType === 'auto' ? autoDetectDecoder(encodedData) : decoderType;
        let decoded;

        notifyProgress('media_extractor', 'progress', `Decoding with ${type}...`);

        switch (type) {
          case 'url':
            decoded = decoders.urlDecode(encodedData);
            break;
          case 'base64':
            decoded = decoders.base64Decode(encodedData);
            break;
          case 'aes':
            if (!aesKey) {
              return { success: false, error: 'aesKey is required for AES decryption' };
            }
            decoded = decoders.decryptAES(encodedData, aesKey, aesIV);
            break;
          default:
            decoded = { success: false, error: 'Unknown decoder type' };
        }

        notifyProgress('media_extractor', 'completed', decoded.success ? 'Decoding successful' : 'Decoding failed');
        return { success: decoded.success, action: 'decode_url', decoderType: type, ...decoded };
      }

      case 'batch_extract': {
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return { success: false, error: 'urls array is required for batch_extract action' };
        }

        notifyProgress('media_extractor', 'progress', `Batch extracting from ${urls.length} URLs...`);

        const results = [];
        const errors = [];

        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          try {
            notifyProgress('media_extractor', 'progress', `Processing ${i + 1}/${urls.length}: ${url}`);

            // Navigate to URL
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000)); // Wait for media to load

            // Extract streams
            const streams = await extractStreamsFromContext(page, 'main');
            const dedupedStreams = deduplicateStreams(streams);
            const totalCount = Object.values(dedupedStreams).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

            // Get page metadata
            const meta = await page.evaluate(() => ({
              title: document.title,
              url: window.location.href
            }));

            results.push({
              url,
              success: true,
              streams: dedupedStreams,
              totalCount,
              title: meta.title,
              finalUrl: meta.url
            });
          } catch (error) {
            errors.push({ url, error: error.message });
            results.push({ url, success: false, error: error.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        notifyProgress('media_extractor', 'completed', `Batch extraction complete: ${successCount}/${urls.length} successful`);

        return {
          success: true,
          action: 'batch_extract',
          totalUrls: urls.length,
          successful: successCount,
          failed: urls.length - successCount,
          results,
          errors
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}. Supported: extract, list_iframes, switch_iframe, player_control, decode_url, batch_extract` };
    }
  },

  async form_automator(params) {
    const { page } = requireBrowser();
    const { data = {}, submit = false, aiMatch = true, captcha = true } = params;

    notifyProgress('form_automator', 'started', '🤖 Starting Universal Form Automation...');

    // 1. Analyze Page Structure
    notifyProgress('form_automator', 'progress', '🔍 Analyzing page structure...');
    const analysis = await ocr.analyzePageForForms(page);

    notifyProgress('form_automator', 'progress', `Found: ${analysis.inputs.length} inputs, ${analysis.dropdowns.length} selects, ${analysis.captchas.length} captchas`);

    // 2. Map and Fill Data
    const filledFields = [];

    // Convert data keys to lowercase for matching
    const normalizedData = {};
    for (const [k, v] of Object.entries(data)) {
      normalizedData[k.toLowerCase()] = v;
    }

    // Combine all fillable fields
    const allFields = [...analysis.inputs, ...analysis.dropdowns];

    for (const field of allFields) {
      let bestMatchKey = null;
      let matchScore = 0;

      // Try to find matching data key
      for (const [dataKey, value] of Object.entries(data)) {
        let score = 0;
        const lowerKey = dataKey.toLowerCase();
        const lowerId = (field.id || '').toLowerCase();
        const lowerName = (field.name || '').toLowerCase();
        const lowerPlaceholder = (field.placeholder || '').toLowerCase();

        // Heuristic Scoring
        if (lowerId === lowerKey) score += 10;
        else if (lowerId.includes(lowerKey)) score += 5;

        if (lowerName === lowerKey) score += 10;
        else if (lowerName.includes(lowerKey)) score += 5;

        if (lowerPlaceholder.includes(lowerKey)) score += 3;

        // Type verification (don't fill 'year' into 'name')
        // ... (simple version for now)

        if (score > matchScore) {
          matchScore = score;
          bestMatchKey = dataKey;
        }
      }

      if (bestMatchKey && matchScore > 0) {
        const value = data[bestMatchKey];
        const identity = field.id ? `#${field.id}` : `[name="${field.name}"]`;

        notifyProgress('form_automator', 'progress', `Filling '${bestMatchKey}' into ${identity}`);

        try {
          if (field.tagName === 'SELECT') {
            // Smart Select
            await page.evaluate((sel, val) => {
              const el = document.querySelector(sel);
              if (!el) return;

              // Try exact value match
              el.value = val;
              if (el.value === val) { // Success
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return;
              }

              // Try text match (fuzzy)
              for (const opt of el.options) {
                if (opt.text.toLowerCase().includes(val.toLowerCase())) {
                  el.value = opt.value;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  break;
                }
              }
            }, identity, String(value));
          } else {
            // Smart Type
            const { createCursor } = require('ghost-cursor-patchright');
            const cursor = createCursor(page);

            // Click center of element
            await cursor.click(identity);

            // Clear existing
            await page.evaluate(s => document.querySelector(s).value = '', identity);

            // Human-like typing
            await page.type(identity, String(value), { delay: Math.floor(Math.random() * 50) + 30 });

            // Random small pause
            await new Promise(r => setTimeout(r, Math.random() * 500));
          }
          filledFields.push(bestMatchKey);
        } catch (e) {
          notifyProgress('form_automator', 'warn', `Failed to fill ${bestMatchKey}: ${e.message}`);
        }
      }
    }

    // 3. Solve Captcha
    if (captcha && analysis.captchas.length > 0) {
      notifyProgress('form_automator', 'progress', '🧩 Processing Captcha...');
      const visibleCaptcha = analysis.captchas.find(c => c.visible);

      if (visibleCaptcha) {
        // Check if we have an input for the captcha
        const captchaInput = analysis.inputs.find(i =>
          i.id?.includes('captcha') ||
          i.name?.includes('captcha') ||
          (i.placeholder && i.placeholder.toLowerCase().includes('captcha'))
        );

        await ocr.solveCaptchaWithVerification(page, {
          captchaSelector: visibleCaptcha.selector || '#captcha_image',
          inputSelector: captchaInput ? (captchaInput.id ? `#${captchaInput.id}` : `[name="${captchaInput.name}"]`) : '#fcaptcha_code',
          aiMode: true,
          autoRetry: true,
          verifyBeforeSubmit: submit // Verify if submitting
        });
      }
    }

    // 4. Submit
    if (submit) {
      notifyProgress('form_automator', 'progress', '🚀 Submitting form...');

      // Find clickables with 'submit', 'search', 'go' text
      const submitSelector = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'));
        const candidates = buttons.filter(b => {
          const text = (b.innerText || b.value || '').toLowerCase();
          return text.includes('submit') || text.includes('go') || text.includes('search') || text.includes('view') || text.includes('login');
        });

        // Sort by likelihood/visibility
        const best = candidates.find(b => b.offsetParent !== null); // First visible one

        if (best) {
          return best.id ? `#${best.id}` : (best.className ? `.${best.className.split(' ')[0]}` : 'button[type="submit"]');
        }
        return null;
      });

      if (submitSelector) {
        const { createCursor } = require('ghost-cursor-patchright');
        const cursor = createCursor(page);
        await cursor.click(submitSelector);

        try {
          await page.waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' });
          notifyProgress('form_automator', 'completed', 'Form submitted and navigation complete');
        } catch (e) {
          notifyProgress('form_automator', 'completed', 'Form submitted (no navigation detected)');
        }
      } else {
        notifyProgress('form_automator', 'warn', 'Could not auto-detect submit button');
      }
    }

    return {
      success: true,
      filledFields,
      message: `Form filled: ${filledFields.join(', ')}`
    };
  }
};

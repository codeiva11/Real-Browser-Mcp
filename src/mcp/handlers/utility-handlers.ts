// Utility handlers — General-purpose tools
import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress, decoders } from './state';
import { handlers } from './index';

// ═══════════════════════════════════════════════════════════════
// Utility Handlers — General-purpose tools
// ═══════════════════════════════════════════════════════════════

export const utilityHandlers = {
  _validateCaptchaText(text: string, expectedLength: number, allowedChars: string) {
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

  async search_regex(params: any) {
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

  async progress_tracker(params: any = {}) {
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

  async deep_analysis(params: any = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], detailed = true } = params;

    notifyProgress('deep_analysis', 'started', 'Analyzing page...');

    const analysis = await page.evaluate(() => {
      const result = {
        seo: {
          title: document.title,
          titleLength: document.title.length,
          h1Count: document.querySelectorAll('h1').length,
          metaDescription: (document.querySelector('meta[name="description"]') as any)?.content,
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

  async file_downloader(params: any) {
    const { page } = requireBrowser();
    const { url, filename, directory = './downloads' } = params;

    notifyProgress('file_downloader', 'started', `Downloading: ${url}`);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const response = await page.goto(url, { waitUntil: 'networkidle' });
    if (!response) {
      notifyProgress('file_downloader', 'error', 'Failed to get response');
      return { success: false, error: 'Failed to get response' };
    }
    const buffer = await response.body();

    const outputFilename = filename || path.basename(new URL(url).pathname) || 'download';
    const outputPath = path.join(directory, outputFilename);

    fs.writeFileSync(outputPath, buffer);

    notifyProgress('file_downloader', 'completed', `Downloaded: ${outputFilename} (${buffer.length} bytes)`, { filename: outputPath, size: buffer.length });

    return { success: true, filename: outputPath, size: buffer.length };
  },

  async iframe_handler(params: any = {}) {
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

  async js_scrape(params: any) {
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

  async execute_js(params: any) {
    const { page } = requireBrowser();
    const {
      code,
      returnValue = true,
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
          if (iframe === 0) {
            context = page.mainFrame() as any;
            frameInfo = { index: 0, url: page.url(), isMain: true };
          } else if (frames[iframe]) {
            context = frames[iframe] as any;
            frameInfo = { index: iframe, url: frames[iframe].url() };
            notifyProgress('execute_js', 'progress', `Switched to iframe ${iframe}: ${frames[iframe].url().substring(0, 50)}...`);
          } else {
            notifyProgress('execute_js', 'error', `iframe index ${iframe} not found. Total frames: ${frames.length}`);
            return { success: false, error: `iframe index ${iframe} not found. Available: 0-${frames.length - 1}` };
          }
        } else if (iframeSelector) {
          const iframeHandle = await page.$(iframeSelector);
          if (iframeHandle) {
            const frame = await iframeHandle.contentFrame();
            if (frame) {
              context = frame as any;
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

      } catch (e: any) {
        notifyProgress('execute_js', 'error', `iframe switch failed: ${e.message}`);
        return { success: false, error: `iframe switch failed: ${e.message}` };
      }
    }

    try {
      const result = await context.evaluate(code);

      notifyProgress('execute_js', 'completed', 'JavaScript executed', {
        hasResult: result !== undefined,
        iframe: frameInfo
      });

      return { success: true, result: returnValue ? result : undefined, iframe: frameInfo };

    } catch (evalError: any) {
      notifyProgress('execute_js', 'error', `Execution error: ${evalError.message}`);
      return { success: false, error: evalError.message, iframe: frameInfo };
    }
  }
};

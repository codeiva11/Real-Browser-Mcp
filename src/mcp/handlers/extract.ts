// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil } from './state';
import { handlers } from './index';

// Auto-generated extract handlers

export const extractHandlers = {
  async get_content(params = {}) {
    const { page } = requireBrowser();
    const { format = 'text', selector, rawHttpUrl } = params;

    notifyProgress('get_content', 'started', `Extracting ${format} content${selector ? ` from ${selector}` : ''}`);

    // === rawHttp mode: fetch raw HTTP response without JS rendering ===
    if (format === 'rawHttp') {
      const url = rawHttpUrl || page.url();
      notifyProgress('get_content', 'in_progress', `Fetching raw HTTP (no JS) from: ${url}`);
      try {
        const cookies = await page.context().cookies(url);
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const response = await fetch(url, {
          headers: {
            'User-Agent': await page.evaluate(() => navigator.userAgent),
            'Cookie': cookieStr,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': page.url()
          },
          redirect: 'follow'
        });
        const rawHtml = await response.text();
        const renderedHtml = await page.content();
        const diff = {
          rawLength: rawHtml.length,
          renderedLength: renderedHtml.length,
          sizeDifference: renderedHtml.length - rawHtml.length,
          jsLoadedContent: renderedHtml.length > rawHtml.length * 1.1
        };
        notifyProgress('get_content', 'completed', `Raw: ${diff.rawLength} chars, Rendered: ${diff.renderedLength} chars`);
        return {
          success: true, rawHtml, renderedHtml, diff,
          url, finalUrl: response.url, statusCode: response.status, format: 'rawHttp'
        };
      } catch (e) {
        return { success: false, error: `Raw HTTP fetch failed: ${e.message}` };
      }
    }

    let content;

    // === markdown: real HTML→Markdown conversion (no external deps) ===
    if (format === 'markdown') {
      if (selector) {
        const exists = await page.$(selector);
        if (!exists) {
          notifyProgress('get_content', 'error', `Element not found: ${selector}`);
          return { success: false, error: `Element not found: ${selector}` };
        }
      }
      content = await page.evaluate((sel) => {
        const root = sel ? document.querySelector(sel) : document.body;
        if (!root) return '';
        const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS']);
        const inline = (node) => {
          let out = '';
          node.childNodes.forEach(c => {
            if (c.nodeType === 3) { out += c.textContent.replace(/\s+/g, ' '); return; }
            if (c.nodeType !== 1 || skip.has(c.tagName)) return;
            const t = c.tagName;
            if (t === 'A') { const h = c.getAttribute('href') || ''; const x = inline(c).trim(); out += h ? `[${x}](${h})` : x; }
            else if (t === 'STRONG' || t === 'B') out += `**${inline(c).trim()}**`;
            else if (t === 'EM' || t === 'I') out += `*${inline(c).trim()}*`;
            else if (t === 'CODE') out += '`' + c.textContent.trim() + '`';
            else if (t === 'IMG') { const a = c.getAttribute('alt') || ''; const s = c.getAttribute('src') || ''; if (s) out += `![${a}](${s})`; }
            else if (t === 'BR') out += '\n';
            else out += inline(c);
          });
          return out;
        };
        const lines = [];
        const walk = (node) => {
          node.childNodes.forEach(c => {
            if (c.nodeType === 3) { const x = c.textContent.trim(); if (x) lines.push(x); return; }
            if (c.nodeType !== 1 || skip.has(c.tagName)) return;
            const t = c.tagName;
            if (/^H[1-6]$/.test(t)) lines.push('\n' + '#'.repeat(+t[1]) + ' ' + inline(c).trim() + '\n');
            else if (t === 'P') { const x = inline(c).trim(); if (x) lines.push(x + '\n'); }
            else if (t === 'UL' || t === 'OL') {
              let i = 1;
              c.querySelectorAll(':scope > li').forEach(li => lines.push((t === 'OL' ? (i++) + '. ' : '- ') + inline(li).trim()));
              lines.push('');
            }
            else if (t === 'BLOCKQUOTE') lines.push('> ' + inline(c).trim() + '\n');
            else if (t === 'PRE') lines.push('```\n' + c.textContent.trim() + '\n```\n');
            else if (t === 'HR') lines.push('\n---\n');
            else if (['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'IMG', 'SPAN', 'LABEL'].includes(t)) { const x = inline(c).trim(); if (x) lines.push(x); }
            else walk(c);
          });
        };
        walk(root);
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      }, selector || null);
    } else if (selector) {
      const element = await page.$(selector);
      if (!element) {
        notifyProgress('get_content', 'error', `Element not found: ${selector}`);
        return { success: false, error: `Element not found: ${selector}` };
      }

      if (format === 'html') {
        content = await element.evaluate(el => el.outerHTML);
      } else {
        content = await element.evaluate(el => el.textContent);
      }
    } else {
      if (format === 'html') {
        content = await page.content();
      } else {
        content = await page.evaluate(() => document.body.innerText);
      }
    }

    notifyProgress('get_content', 'completed', `Extracted ${content.length} characters`, { format, length: content.length });

    return {
      success: true,
      content,
      url: page.url(),
      format
    };
  },

  async save_content_as_markdown(params) {
    const { page } = requireBrowser();
    const { filename, selector, includeImages = true, includeMeta = true } = params;

    notifyProgress('save_content_as_markdown', 'started', `Saving to: ${filename}`);

    let markdown = '';

    if (includeMeta) {
      const title = await page.title();
      const url = page.url();
      markdown += `# ${title}\n\n`;
      markdown += `> Source: ${url}\n\n`;
    }

    const content = selector
      ? await page.$eval(selector, el => el.innerText)
      : await page.evaluate(() => document.body.innerText);

    markdown += content;

    const outputPath = path.resolve(filename);
    fs.writeFileSync(outputPath, markdown);

    notifyProgress('save_content_as_markdown', 'completed', `Saved ${markdown.length} bytes to ${filename}`, { filename: outputPath, size: markdown.length });

    return { success: true, filename: outputPath, size: markdown.length };
  },

  async extract_json(params = {}) {
    const { page } = requireBrowser();
    const { source = 'page', selector, jsonPath } = params;

    notifyProgress('extract_json', 'started', `Extracting JSON from: ${source}`);

    let jsonData = [];

    if (source === 'ld+json') {
      jsonData = await page.$$eval('script[type="application/ld+json"]', scripts =>
        scripts.map(s => {
          try { return JSON.parse(s.textContent); } catch { return null; }
        }).filter(Boolean)
      );
    } else if (source === 'scripts') {
      const content = await page.$$eval('script', scripts => scripts.map(s => s.textContent).join('\n'));
      const jsonRegex = /\{[^{}]*\}|\[[^\[\]]*\]/g;
      const matches = content.match(jsonRegex) || [];
      jsonData = matches.slice(0, 20).map(m => {
        try { return JSON.parse(m); } catch { return null; }
      }).filter(Boolean);
    } else if (selector) {
      const text = await page.$eval(selector, el => el.textContent);
      try { jsonData = [JSON.parse(text)]; } catch { }
    }

    notifyProgress('extract_json', 'completed', `Extracted ${jsonData.length} JSON objects`, { count: jsonData.length });

    return { success: true, source, count: jsonData.length, data: jsonData };
  },

  async scrape_meta_tags(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'] } = params;

    notifyProgress('scrape_meta_tags', 'started', 'Extracting meta tags...');

    const meta = await page.evaluate(() => {
      const result = { meta: {}, og: {}, twitter: {} };

      document.querySelectorAll('meta').forEach(tag => {
        const name = tag.getAttribute('name') || tag.getAttribute('property');
        const content = tag.getAttribute('content');
        if (name && content) {
          if (name.startsWith('og:')) {
            result.og[name.replace('og:', '')] = content;
          } else if (name.startsWith('twitter:')) {
            result.twitter[name.replace('twitter:', '')] = content;
          } else {
            result.meta[name] = content;
          }
        }
      });

      result.title = document.title;
      result.canonical = document.querySelector('link[rel="canonical"]')?.href;

      return result;
    });

    const tagCount = Object.keys(meta.meta).length + Object.keys(meta.og).length + Object.keys(meta.twitter).length;
    notifyProgress('scrape_meta_tags', 'completed', `Extracted ${tagCount} meta tags`, { tagCount });

    return { success: true, ...meta };
  },

  async link_harvester(params = {}) {
    const { page } = requireBrowser();
    const { types = ['all'], selector, includeText = true, includeHidden = true, searchIframes = false } = params;

    notifyProgress('link_harvester', 'started', 'Harvesting links (enhanced mode)...');

    const currentHost = new URL(page.url()).hostname;

    // Enhanced link extraction
    const extractLinks = async (context) => {
      return await context.evaluate(({ includeText, includeHidden }) => {
        const allLinks = [];
        const seenUrls = new Set();

        const addLink = (href, text, source, element) => {
          if (!href || seenUrls.has(href)) return;
          if (!href.startsWith('http') && !href.startsWith('//')) return;

          // Handle protocol-relative URLs
          if (href.startsWith('//')) {
            href = window.location.protocol + href;
          }

          seenUrls.add(href);
          allLinks.push({
            href,
            text: includeText ? (text || '').trim().substring(0, 100) : undefined,
            source,
            hidden: element ? (
              element.offsetParent === null ||
              getComputedStyle(element).display === 'none' ||
              getComputedStyle(element).visibility === 'hidden'
            ) : false
          });
        };

        // 1. Standard anchor tags
        document.querySelectorAll('a[href]').forEach(a => {
          addLink(a.href, a.textContent, 'anchor', a);
        });

        // 2. Data attributes containing URLs
        const dataAttrs = ['data-href', 'data-url', 'data-link', 'data-src', 'data-file', 'data-download'];
        dataAttrs.forEach(attr => {
          document.querySelectorAll(`[${attr}]`).forEach(el => {
            const url = el.getAttribute(attr);
            addLink(url, el.textContent, `${attr}`, el);
          });
        });

        // 3. OnClick handlers with URLs
        if (includeHidden) {
          document.querySelectorAll('[onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick');
            // Look for URL patterns in onclick
            const urlMatches = onclick.match(/https?:\/\/[^\s"'<>]+/gi) || [];
            urlMatches.forEach(url => {
              addLink(url, el.textContent, 'onclick', el);
            });

            // Look for location.href assignments
            const hrefMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (hrefMatch) {
              addLink(hrefMatch[1], el.textContent, 'onclick-location', el);
            }

            // Look for window.open calls
            const openMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
            if (openMatch) {
              addLink(openMatch[1], el.textContent, 'onclick-window-open', el);
            }
          });
        }

        // 4. JavaScript href links
        document.querySelectorAll('a[href^="javascript:"]').forEach(a => {
          const href = a.getAttribute('href');
          const urlMatch = href.match(/https?:\/\/[^\s"'<>]+/gi);
          if (urlMatch) {
            urlMatch.forEach(url => addLink(url, a.textContent, 'javascript-href', a));
          }
        });

        // 5. Hidden inputs with URLs
        document.querySelectorAll('input[type="hidden"]').forEach(input => {
          const value = input.value;
          if (value && (value.startsWith('http') || value.startsWith('//'))) {
            addLink(value, input.name || input.id, 'hidden-input', input);
          }
        });

        // 6. Script content analysis for URLs (limited for performance)
        if (includeHidden) {
          const scripts = [...document.querySelectorAll('script')].slice(0, 20);
          scripts.forEach(script => {
            const content = script.textContent || '';
            // Look for download/stream URLs
            const patterns = [
              /["']?(https?:\/\/[^"'\s<>]+\.(mp4|mkv|avi|m3u8|mpd|zip|rar|pdf))[^"'\s<>]*["']?/gi,
              /download[_-]?url\s*[:=]\s*["']([^"']+)["']/gi,
              /file\s*[:=]\s*["']([^"']+)["']/gi
            ];

            patterns.forEach(pattern => {
              let match;
              while ((match = pattern.exec(content)) !== null) {
                addLink(match[1], 'script-extracted', 'script', null);
              }
            });
          });
        }

        // 7. Meta refresh URLs
        const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
        if (metaRefresh) {
          const content = metaRefresh.getAttribute('content');
          const urlMatch = content?.match(/url=(.+)/i);
          if (urlMatch) {
            addLink(urlMatch[1].trim().replace(/['"]/g, ''), 'meta-refresh', 'meta', null);
          }
        }

        // 8. Iframe sources
        document.querySelectorAll('iframe[src]').forEach(iframe => {
          addLink(iframe.src, 'iframe', 'iframe', iframe);
        });

        return allLinks;
      }, { includeText, includeHidden }).catch(() => []);
    };

    let links = await extractLinks(page);

    // Search iframes if enabled
    if (searchIframes) {
      const frames = page.frames();
      for (let i = 1; i < frames.length && i < 5; i++) {
        try {
          const frame = frames[i];
          if (frame.url() && frame.url() !== 'about:blank') {
            const frameLinks = await extractLinks(frame);
            frameLinks.forEach(link => link.source = `iframe:${link.source}`);
            links = [...links, ...frameLinks];
          }
        } catch (e) { }
      }
    }

    // Filter by type
    if (!types.includes('all')) {
      links = links.filter(link => {
        const isInternal = link.href.includes(currentHost);
        const isMedia = /\.(jpg|jpeg|png|gif|mp4|mp3|mkv|avi|pdf|zip|rar|m3u8|mpd)/i.test(link.href);
        const isDownload = /download|file|drive/i.test(link.href);

        if (types.includes('internal') && isInternal) return true;
        if (types.includes('external') && !isInternal) return true;
        if (types.includes('media') && isMedia) return true;
        if (types.includes('download') && isDownload) return true;
        if (types.includes('hidden') && link.hidden) return true;
        return false;
      });
    }

    // Remove hidden links if not requested
    if (!includeHidden) {
      links = links.filter(link => !link.hidden);
    }

    // Deduplicate
    const seen = new Set();
    links = links.filter(link => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });

    notifyProgress('link_harvester', 'completed', `Found ${links.length} links (including hidden)`, { count: links.length });

    return { success: true, count: links.length, links };
  }
};

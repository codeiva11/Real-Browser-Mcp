import * as path from 'path';
import * as fs from 'fs';

import { state, requireBrowser, notifyProgress, getHeadlessFromEnv, decoders, setProgressCallback, resolveWaitUntil } from './state';


// Auto-generated extract handlers

export const extractHandlers = {
  async get_content(params: any = {}) {
    const { page } = requireBrowser();
    let { format = 'text', selector, xpath, text, rawHttpUrl, saveAs, includeMeta = false, multiple = false, extractAttributes = false } = params;

    const targetSelector = selector || (xpath ? `xpath=${xpath}` : null) || (text ? `text="${text}"` : null);

    if (rawHttpUrl && format !== 'rawHttp') {
      format = 'rawHttp';
    }

    notifyProgress('get_content', 'started', `Extracting ${format} content${targetSelector ? ` from ${targetSelector}` : ''}`);

    // === elements mode (replaces find_element) ===
    if (format === 'elements' || extractAttributes) {
      if (!targetSelector) return { success: false, error: 'selector, xpath, or text required for elements extraction' };
      let elements: any[] = [];
      if (multiple) {
        elements = await page.$$eval(targetSelector, (els: any[]) => els.map(el => {
          const rect = el.getBoundingClientRect();
          const attrs: any = {};
          for (const attr of el.attributes) attrs[attr.name] = attr.value;
          return { tag: el.tagName, text: el.textContent?.substring(0, 100), html: el.outerHTML, attributes: attrs, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        }));
      } else {
        const el = await page.$(targetSelector);
        if (el) {
          elements = [await el.evaluate((el: any) => {
            const rect = el.getBoundingClientRect();
            const attrs: any = {};
            for (const attr of el.attributes) attrs[attr.name] = attr.value;
            return { tag: el.tagName, text: el.textContent?.substring(0, 100), html: el.outerHTML, attributes: attrs, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
          })];
        }
      }
      notifyProgress('get_content', 'completed', `Found ${elements.length} element(s)`);
      if (saveAs) {
        fs.writeFileSync(path.resolve(saveAs), JSON.stringify(elements, null, 2));
      }
      return { success: true, format: 'elements', found: elements.length, elements, savedTo: saveAs ? path.resolve(saveAs) : null };
    }

    // === rawHttp mode: fetch raw HTTP response without JS rendering ===
    if (format === 'rawHttp') {
      const url = rawHttpUrl || page.url();
      notifyProgress('get_content', 'in_progress', `Fetching raw HTTP (no JS) from: ${url}`);
      try {
        const cookies = await page.context().cookies(url);
        const cookieStr = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
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
        
        let outHtml = rawHtml;
        if (saveAs) {
          fs.writeFileSync(path.resolve(saveAs), outHtml);
        }
        return {
          success: true, rawHtml, renderedHtml, diff,
          url, finalUrl: response.url, statusCode: response.status, format: 'rawHttp',
          savedTo: saveAs ? path.resolve(saveAs) : null
        };
      } catch (e: any) {
        return { success: false, error: `Raw HTTP fetch failed: ${e.message}` };
      }
    }

    let content;

    // === markdown: real HTML→Markdown conversion ===
    if (format === 'markdown') {
      if (targetSelector) {
        const exists = await page.$(targetSelector);
        if (!exists) {
          notifyProgress('get_content', 'error', `Element not found: ${targetSelector}`);
          return { success: false, error: `Element not found: ${targetSelector}. 💡 AI HINT: The selector might be wrong. Try using xpath or text instead, or use see_page(annotate: true) to find the correct element.` };
        }
      }
      content = await page.evaluate((sel) => {
        const root = sel ? document.querySelector(sel) : document.body;
        if (!root) return '';
        const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS']);
        const inline = (node: any) => {
          let out = '';
          node.childNodes.forEach((c: any) => {
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
        const lines: any[] = [];
        const walk = (node: any) => {
          node.childNodes.forEach((c: any) => {
            if (c.nodeType === 3) { const x = c.textContent.trim(); if (x) lines.push(x); return; }
            if (c.nodeType !== 1 || skip.has(c.tagName)) return;
            const t = c.tagName;
            if (/^H[1-6]$/.test(t)) lines.push('\n' + '#'.repeat(+t[1]) + ' ' + inline(c).trim() + '\n');
            else if (t === 'P') { const x = inline(c).trim(); if (x) lines.push(x + '\n'); }
            else if (t === 'UL' || t === 'OL') {
              let i = 1;
              c.querySelectorAll(':scope > li').forEach((li: any) => lines.push((t === 'OL' ? (i++) + '. ' : '- ') + inline(li).trim()));
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
      }, targetSelector || null);
    } else if (targetSelector) {
      const element = await page.$(targetSelector);
      if (!element) {
        notifyProgress('get_content', 'error', `Element not found: ${targetSelector}`);
        return { success: false, error: `Element not found: ${targetSelector}. 💡 AI HINT: The selector might be wrong. Try using xpath or text instead, or use see_page(annotate: true) to find the correct element.` };
      }

      if (format === 'html') {
        content = await element.evaluate((el: any) => el.outerHTML);
      } else {
        content = await element.evaluate((el: any) => el.textContent);
      }
    } else {
      if (format === 'html') {
        content = await page.content();
      } else {
        content = await page.evaluate(() => document.body.innerText);
      }
    }

    let prefix = '';
    if (includeMeta) {
      const title = await page.title();
      prefix = format === 'markdown' ? `# ${title}\n> Source: ${page.url()}\n\n` : `Title: ${title}\nURL: ${page.url()}\n\n`;
    }
    content = prefix + content;

    if (saveAs) {
      const outputPath = path.resolve(saveAs);
      fs.writeFileSync(outputPath, content);
      notifyProgress('get_content', 'completed', `Saved ${content.length} chars to ${saveAs}`, { format, length: content.length, savedTo: outputPath });
      return { success: true, url: page.url(), format, length: content.length, savedTo: outputPath };
    }

    notifyProgress('get_content', 'completed', `Extracted ${content.length} characters`, { format, length: content.length });

    return {
      success: true,
      content,
      url: page.url(),
      format
    };
  }
};

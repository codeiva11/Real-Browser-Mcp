import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress } from './state';
import type { SeePageParams } from '../../types';

/**
 * seePage — AI Vision ("Eyes")
 *
 * यह फंक्शन इंसान की तरह पेज को देखता है:
 * - डिफ़ॉल्ट रूप से पूरा पेज (fullPage) देखता है ताकि एक ही बार में सब कुछ दिख जाए
 * - डिफ़ॉल्ट रूप से annotate करता है ताकि AI तुरंत annotationId से click/type कर सके
 * - डिफ़ॉल्ट रूप से autoHover करता है ताकि hidden dropdowns/menus खुल जाएँ
 * - डिफ़ॉल्ट रूप से watchMutations चालू है ताकि DOM बदलाव पकड़े जाएँ
 *
 * AI एजेंट को बस see_page कॉल करना है — बाकी सब अपने आप हो जाता है।
 */
export async function seePage(params: SeePageParams = {}) {
  const { page } = requireBrowser();

  // ─── इंसान की तरह डिफ़ॉल्ट: एक ही बार में पूरा पेज देखो ───
  const {
    fullPage = true,          // पूरा पेज एक शॉट में (इंसान भी पूरा देखता है)
    format = 'jpeg',
    quality = 70,
    includeElements = true,
    annotate = true,          // डिफ़ॉल्ट रूप से annotation चालू (AI तुरंत click/type कर सके)
    includeDomText = false,
    maxElements = 80,         // 60 → 80: ज्यादा elements देखने के लिए
    path: savePath,
    autoHover = true,          // डिफ़ॉल्ट रूप से hover करें (hidden dropdowns reveal करने)
    watchMutations = true     // डिफ़ॉल्ट रूप से mutations देखें
  } = params;

  notifyProgress('see_page', 'started', `👁️ Looking at the page (${fullPage ? 'full page' : 'viewport'})${annotate ? ' with Super Annotations' : ''}...`);

  // ─── FIX: state.activeAnnotations हमेशा reset करें (stale डेटा से बचने) ───
  state.activeAnnotations = {};

  // ─── MutationObserver with memory cap (memory leak fix) ───
  let mutationsSinceLastCheck: any[] = [];
  if (watchMutations) {
    mutationsSinceLastCheck = await page.evaluate(() => {
      const MAX_MUTATIONS = 100; // cap to prevent memory leak
      if (!(window as any).__mutations) {
        (window as any).__mutations = [];
        (window as any).__mutationObserver = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.addedNodes.length) {
              const text = Array.from(m.addedNodes).map((n: any) => n.innerText || '').join(' ').trim();
              if (text.length > 5) {
                (window as any).__mutations.push({ time: Date.now(), text: text.slice(0, 100) });
                // cap the array — remove oldest entries
                if ((window as any).__mutations.length > MAX_MUTATIONS) {
                  (window as any).__mutations = (window as any).__mutations.slice(-MAX_MUTATIONS);
                }
              }
            }
          }
        });
        (window as any).__mutationObserver.observe(document.body, { childList: true, subtree: true });
      }
      const recent = [...(window as any).__mutations];
      (window as any).__mutations = [];
      return recent;
    }).catch((e: any) => {
      notifyProgress('see_page', 'warn', `Mutation watch failed: ${e.message}`);
      return [];
    });
  }

  // ─── autoHover: hidden dropdowns/menus reveal करें (इंसान भी hover करता है) ───
  if (autoHover) {
    notifyProgress('see_page', 'progress', 'Hovering over menus to reveal dropdowns...');
    await page.evaluate(() => {
      const hoverables = document.querySelectorAll('nav, li, [role="menuitem"], .dropdown, [aria-haspopup="true"], [role="menu"], [role="menubar"]');
      hoverables.forEach(el => {
        try {
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        } catch(e) {}
      });
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
  }

  let elements: any[] = [];
  let pageInfo: any = {};

  // ─── Interactive elements का visual map (annotate + includeElements) ───
  if (includeElements || annotate) {
    const data = await page.evaluate(({ maxEls, isFullPage, doAnnotate }: any) => {
      const out: any[] = [];
      const seen = new Set();
      const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [onclick], [tabindex], summary, details, label[for]';
      const nodes = document.querySelectorAll(sel);

      const cssPath = (el: any) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 4) {
          let part = node.tagName.toLowerCase();
          if (node.classList.length) {
            const cls = Array.from(node.classList).slice(0, 2).map((c: any) => '.' + CSS.escape(c)).join('');
            part += cls;
          }
          const parent = node.parentElement;
          if (parent) {
            const sibs = Array.from(parent.children).filter((c: any) => c.tagName === node.tagName);
            if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
          }
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };

      let elementIdCounter = 1;
      const boxesToInject = [];

      for (const el of nodes) {
        if (out.length >= maxEls) break;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        if (!isFullPage) {
          if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
        }

        const tag = el.tagName.toLowerCase();
        let label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('for') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        let kind = tag;
        if (tag === 'a') kind = 'link';
        else if (tag === 'button' || el.getAttribute('role') === 'button') kind = 'button';
        else if (tag === 'input') kind = `input:${el.type || 'text'}`;
        else if (tag === 'select') kind = 'select';
        else if (tag === 'textarea') kind = 'textarea';
        else if (tag === 'summary') kind = 'summary';
        else if (tag === 'label') kind = 'label';
        else if (el.getAttribute('role') === 'checkbox') kind = 'checkbox';
        else if (el.getAttribute('role') === 'radio') kind = 'radio';

        const selector = cssPath(el);
        if (seen.has(selector + '|' + label)) continue;
        seen.add(selector + '|' + label);

        const annotationId = elementIdCounter++;
        if (doAnnotate) boxesToInject.push({ id: annotationId, rect, tag: kind });

        out.push({
          id: annotationId, kind, text: label, selector,
          href: tag === 'a' ? (el as any).href : undefined,
          box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        });
      }

      if (doAnnotate && boxesToInject.length > 0) {
        let container = document.getElementById('real-browser-annotations');
        if (container) container.remove();
        container = document.createElement('div');
        container.id = 'real-browser-annotations';
        container.style.position = 'absolute';
        container.style.top = '0'; container.style.left = '0';
        container.style.width = '100%'; container.style.height = '100%';
        container.style.pointerEvents = 'none'; container.style.zIndex = '2147483647';
        for (const box of boxesToInject) {
          const absoluteY = box.rect.y + window.scrollY;
          const absoluteX = box.rect.x + window.scrollX;
          const div = document.createElement('div');
          div.style.position = 'absolute'; div.style.border = '2px solid red';
          div.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
          div.style.left = absoluteX + 'px'; div.style.top = absoluteY + 'px';
          div.style.width = box.rect.width + 'px'; div.style.height = box.rect.height + 'px';
          div.style.boxSizing = 'border-box';
          const label = document.createElement('div');
          label.innerText = String(box.id);
          label.style.position = 'absolute'; label.style.top = '-2px'; label.style.left = '-2px';
          label.style.backgroundColor = 'red'; label.style.color = 'white';
          label.style.fontSize = '12px'; label.style.fontWeight = 'bold';
          label.style.padding = '1px 4px'; label.style.fontFamily = 'monospace';
          label.style.borderBottomRightRadius = '4px';
          div.appendChild(label);
          container.appendChild(div);
        }
        document.body.appendChild(container);
      }

      return {
        elements: out,
        info: {
          title: document.title, url: location.href,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: Math.round(window.scrollY), scrollHeight: document.body ? document.body.scrollHeight : 0
        }
      };
    }, { maxEls: maxElements, isFullPage: fullPage, doAnnotate: annotate }).catch((e: any) => {
      notifyProgress('see_page', 'error', `Element extraction failed: ${e.message}`);
      return { elements: [], info: {} };
    });

    elements = data.elements || [];
    pageInfo = data.info || {};

    // ─── activeAnnotations अपडेट करें (click/type टूल्स के लिए) ───
    for (const el of elements) state.activeAnnotations[el.id] = { selector: el.selector, text: el.text, type: el.kind };
  }

  // ─── स्क्रीनशॉट कैप्चर ───
  const shotOpts: any = { type: format, fullPage };
  if (format === 'jpeg' && typeof quality === 'number') shotOpts.quality = quality;

  let buffer;
  try {
    buffer = await page.screenshot(shotOpts);
  } catch (e: any) {
    return { success: false, error: `Vision capture failed: ${e.message}` };
  }

  // ─── annotation cleanup (स्क्रीनशॉट के बाद हटा दो) ───
  if (annotate) {
    await page.evaluate(() => {
      const container = document.getElementById('real-browser-annotations');
      if (container) container.remove();
    }).catch(() => {});
  }

  let domText = undefined;
  if (includeDomText) {
    domText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  }

  let savedTo = null;
  if (savePath) {
    try {
      const dir = path.dirname(savePath);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, buffer);
      savedTo = savePath;
    } catch (e: any) {
      notifyProgress('see_page', 'warn', `Could not save screenshot: ${e.message}`);
    }
  }

  notifyProgress('see_page', 'completed',
    `👁️ Saw the page: ${elements.length} interactive elements visible${savedTo ? ' (saved ' + savedTo + ')' : ''}`);

  const base64 = Buffer.from(buffer).toString('base64');
  const summary = {
    success: true,
    url: pageInfo.url || page.url(),
    title: pageInfo.title,
    viewport: pageInfo.viewport,
    scroll: { y: pageInfo.scrollY, pageHeight: pageInfo.scrollHeight },
    visibleInteractiveElements: elements.length,
    domText,
    mutationsSinceLastCheck: watchMutations ? mutationsSinceLastCheck : undefined,
    elements,
    savedTo,
    // ─── AI के लिए निर्देश: अब annotationId से click/type कर सकते हैं ───
    hint: elements.length > 0
      ? `Use annotationId (1-${elements.length}) with click/type tools to interact with elements. Example: click({ annotationId: 1 }) or type({ annotationId: 5, text: "hello" }).`
      : undefined
  };

  return {
    mcpContent: [
      { type: 'image', data: base64, mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' },
      { type: 'text', text: `If the current model cannot read images, ignore the attached image and use this JSON summary instead.\n\n${JSON.stringify(summary, null, 2)}` }
    ],
    ...summary
  };
}
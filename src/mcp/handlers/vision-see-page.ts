import * as path from 'path';
import * as fs from 'fs';
import { state, requireBrowser, notifyProgress } from './state';
import { domHandlers } from './dom';
import { browserHandlers } from './browser';
import { extractHandlers } from './extract';
import type { SeePageParams } from '../../types';

/** Resolve a user-supplied save path, preventing path traversal outside cwd. */
function safeResolve(savePath: string): string | null {
  const resolved = path.resolve(savePath);
  const cwd = path.resolve(process.cwd());
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return null;
  return resolved;
}

type StepResult = { step: number; action: string; success: boolean; result?: any; error?: string };

function detectStepError(res: any): string | null {
  if (!res) return 'no result';
  if (res.success === false) return res.error || 'step failed';
  return null;
}

export async function seePage(params: SeePageParams = {}) {
  const { page } = requireBrowser();
  const {
    fullPage = false,
    format = 'jpeg',
    quality = 70,
    includeElements = true,
    annotate = false,
    includeDomText = false,
    includePageText = true,
    scanIframes = true,
    maxElements = 60,
    path: savePath,
    autoHover = false,
    watchMutations = false,
    // Continuous workflow (merged from the former browse_task tool)
    steps,
    captureBefore = true,
    captureAfter = true,
    stopOnError = true
  } = params;

  notifyProgress('see_page', 'started', `👁️ Looking at the page (${fullPage ? 'full page' : 'viewport'})${annotate ? ' with Super Annotations' : ''}...`);

  let mutationsSinceLastCheck: any[] = [];
  if (watchMutations) {
    mutationsSinceLastCheck = await page.evaluate(() => {
      if (!(window as any).__mutations) {
        (window as any).__mutations = [];
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.addedNodes.length) {
              const text = Array.from(m.addedNodes).map((n: any) => n.innerText || '').join(' ').trim();
              if (text.length > 5) (window as any).__mutations.push({ time: Date.now(), text: text.slice(0, 100) });
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      const recent = [...(window as any).__mutations];
      (window as any).__mutations = [];
      return recent;
    });
  }

  if (autoHover) {
    notifyProgress('see_page', 'progress', 'Hovering over menus to reveal dropdowns...');
    await page.evaluate(() => {
      const hoverables = document.querySelectorAll('nav, li, [role="menuitem"], .dropdown, [aria-haspopup="true"]');
      hoverables.forEach(el => {
        try {
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        } catch(e) {}
      });
    });
    await new Promise(r => setTimeout(r, 400));
  }

  let elements: any[] = [];
  let pageInfo: any = {};

  if (includeElements || annotate) {
    const data = await page.evaluate(({ maxEls, isFullPage, doAnnotate }: any) => {
      const out: any[] = [];
      const seen = new Set();
      const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]';
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
        let label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        let kind = tag;
        if (tag === 'a') kind = 'link';
        else if (tag === 'button' || el.getAttribute('role') === 'button') kind = 'button';
        else if (tag === 'input') kind = `input:${el.type || 'text'}`;
        else if (tag === 'select') kind = 'select';
        else if (tag === 'textarea') kind = 'textarea';

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
    }, { maxEls: maxElements, isFullPage: fullPage, doAnnotate: annotate }).catch((e: any) => { console.error(e); return { elements: [], info: {} } });

    elements = data.elements || [];
    pageInfo = data.info || {};

    // Rich single-shot extras: full page text + iframe inventory, so the
    // AI agent can plan and execute an entire multi-step task from ONE view
    // instead of re-capturing the page after every action.
    if (includePageText) {
      pageInfo.pageText = await page.evaluate(() => (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 8000)).catch(() => '');
    }
    if (scanIframes) {
      try {
        pageInfo.iframes = page.frames().map((f: any, i: number) => ({ index: i, url: f.url(), name: f.name() }));
      } catch { /* ignore */ }
    }

    state.activeAnnotations = {};
    for (const el of elements) state.activeAnnotations[el.id] = { selector: el.selector, text: el.text, type: el.kind };
  }

  const shotOpts: any = { type: format, fullPage };
  if (format === 'jpeg' && typeof quality === 'number') shotOpts.quality = quality;

  let buffer;
  try {
    buffer = await page.screenshot(shotOpts);
  } catch (e: any) {
    return { success: false, error: `Vision capture failed: ${e.message}` };
  }

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
    const resolved = safeResolve(savePath);
    if (!resolved) return { success: false, error: 'path is outside the working directory (path traversal blocked).' };
    const dir = path.dirname(resolved);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, buffer);
    savedTo = resolved;
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
    pageText: pageInfo.pageText,
    iframes: pageInfo.iframes,
    domText,
    mutationsSinceLastCheck: watchMutations ? mutationsSinceLastCheck : undefined,
    elements,
    savedTo
  };

  const mcpContent: any[] = [
    { type: 'image', data: base64, mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' },
    { type: 'text', text: `If the current model cannot read images, ignore the attached image and use this JSON summary instead.\n\n${JSON.stringify(summary, null, 2)}` }
  ];

  // ---- Continuous human-like workflow (merged browse_task) ----
  // If `steps` is provided, run them back-to-back in ONE flow without
  // re-capturing the page between steps, then append before/after screenshots
  // and a per-step report to the same response.
  if (Array.isArray(steps) && steps.length > 0) {
    let beforeImage: string | null = null;
    if (captureBefore) {
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
        beforeImage = Buffer.from(buf).toString('base64');
      } catch { /* ignore */ }
    }

    const stepResults: StepResult[] = [];
    let failed = false;
    const maxAttempts = 3;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const action = step.action;
      notifyProgress('see_page', 'progress', `Step ${i + 1}/${steps.length}: ${action}`);

      let res: any = null;
      let err: string | null = null;
      let stepSuccess = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          switch (action) {
            case 'click':
              res = await domHandlers.click({
                selector: step.selector,
                annotationId: step.annotationId,
                humanLike: step.humanLike !== false,
                retries: step.retries ?? 2,
                timeout: step.timeout ?? 10000,
              });
              break;
            case 'type':
              res = await domHandlers.type({
                selector: step.selector,
                annotationId: step.annotationId,
                text: step.text ?? '',
                clear: step.clear !== false,
                pressEnter: step.pressEnter === true,
              });
              break;
            case 'press_key':
              res = await domHandlers.press_key({
                key: step.key ?? '',
                modifiers: step.modifiers,
                count: step.count ?? 1,
              });
              break;
            case 'scroll':
              res = await domHandlers.random_scroll({
                direction: step.direction ?? 'down',
                amount: step.amount ?? 300,
                smooth: step.smooth !== false,
              });
              break;
            case 'wait':
              res = await browserHandlers.wait({
                type: step.waitType ?? 'timeout',
                value: step.value,
                timeout: step.timeout ?? 5000,
              });
              break;
            case 'extract':
              res = await extractHandlers.get_content({
                format: step.format ?? 'text',
                selector: step.selector,
                xpath: step.xpath,
                text: step.text,
              });
              break;
            case 'see':
              res = await seePage({
                fullPage: step.fullPage === true,
                annotate: step.annotate === true,
                includePageText: step.includePageText !== false,
                scanIframes: step.scanIframes !== false,
              });
              break;
            default:
              res = { success: false, error: `Unknown step action: ${action}` };
          }

          err = detectStepError(res);
          if (!err) {
            stepSuccess = true;
            break;
          }
        } catch (e: any) {
          err = e?.message || String(e);
        }

        if (attempt < maxAttempts) {
          notifyProgress('see_page', 'warn', `Step ${i + 1} failed: ${err}. Retrying (${attempt}/${maxAttempts})...`);
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      if (!stepSuccess) {
        stepResults.push({ step: i + 1, action, success: false, error: err || 'Unknown error' });
        failed = true;
        if (stopOnError) {
          notifyProgress('see_page', 'error', `Step ${i + 1} failed after ${maxAttempts} attempts: ${err}. Stopping sequence.`);
          break;
        }
      } else {
        stepResults.push({ step: i + 1, action, success: true, result: res });
      }
    }

    let afterImage: string | null = null;
    if (captureAfter) {
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
        afterImage = Buffer.from(buf).toString('base64');
      } catch { /* ignore */ }
    }

    notifyProgress('see_page', 'completed', `🧭 Completed ${stepResults.length}/${steps.length} steps`);

    if (beforeImage) {
      mcpContent.push({ type: 'image', data: beforeImage, mimeType: 'image/jpeg' });
    }
    if (afterImage) {
      mcpContent.push({ type: 'image', data: afterImage, mimeType: 'image/jpeg' });
    }
    mcpContent.push({
      type: 'text',
      text: `Browse task finished. Steps executed: ${stepResults.length}/${steps.length}.\n${JSON.stringify(
        stepResults.map(r => ({ step: r.step, action: r.action, success: r.success, error: r.error || undefined })),
        null, 2
      )}`,
    });
  }

  return {
    success: true,
    mcpContent,
  };
}

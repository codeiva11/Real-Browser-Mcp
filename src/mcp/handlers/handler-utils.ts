import { notifyProgress } from './state';
import { helpersHandlers } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AI SELECTOR HEALING (self-healing selectors)
 * ═══════════════════════════════════════════════════════════════════════════
 * When a CSS selector fails to match, this heuristic scans the DOM for the most
 * likely intended element and returns a fresh, robust selector for it.
 *
 * Improvements over the old per-handler logic:
 *  - Scoring model: picks the BEST candidate, not the first loose match.
 *  - Visibility-aware: hidden/zero-size elements are skipped.
 *  - Rich signals: text, id, class, name, placeholder, aria-label, title,
 *    data-testid, value, type, role, alt.
 *  - Exact/word-boundary matches score higher than loose substring matches.
 *  - Emits a stable, unique selector (id > data-testid > name > scoped class/nth).
 *  - Mode-aware candidate sets: 'click' (interactive) vs 'type' (form fields).
 */

export type HealMode = 'click' | 'type';

/**
 * Attempt to heal a broken selector by finding the best-matching visible element.
 * Runs entirely in-page via page.evaluate. Returns a new selector string or null.
 */
export async function healSelector(
  context: any,
  brokenSelector: string,
  mode: HealMode
): Promise<{ selector: string; score: number; label: string } | null> {
  const result = await context.evaluate(
    (args: { sel: string; mode: string }) => {
      const { sel, mode } = args;

      // Tokenize the broken selector into meaningful words.
      const rawTokens = sel
        .replace(/[#.>~+*\[\]="'():,]/g, ' ')
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t: string) => t.length > 1 && !['div', 'span', 'the', 'btn'].includes(t));

      // If the original selector carried an explicit id/name/testid token, keep it too.
      const idMatch = sel.match(/#([\w-]+)/);
      const nameMatch = sel.match(/\[name=["']?([\w-]+)["']?\]/i);
      const testIdMatch = sel.match(/\[data-testid=["']?([\w-]+)["']?\]/i);
      const strongTokens = [idMatch?.[1], nameMatch?.[1], testIdMatch?.[1]]
        .filter(Boolean)
        .map((t) => String(t).toLowerCase());

      const isVisible = (el: Element): boolean => {
        const he = el as HTMLElement;
        const style = window.getComputedStyle(he);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        const rect = he.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const selectorSet =
        mode === 'type'
          ? 'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"]'
          : 'a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], summary, label';

      const candidates = Array.from(document.querySelectorAll(selectorSet));

      // Normalize so that "-" and "_" act as word separators. This lets tokens like
      // "email" match attributes such as name="user_email" or class="password-input".
      const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ');
      const attrsOf = (el: Element): string[] => {
        const g = (n: string) => norm(el.getAttribute(n) || '');
        const vals = [
          norm((el.textContent || '').trim().slice(0, 120)),
          norm(el.id || ''),
          norm(typeof el.className === 'string' ? el.className : ''),
          g('name'),
          g('placeholder'),
          g('aria-label'),
          g('title'),
          g('data-testid'),
          g('value'),
          g('type'),
          g('role'),
          g('alt'),
        ];
        return vals.filter(Boolean);
      };

      let best: { el: Element; score: number; label: string } | null = null;

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const haystack = attrsOf(el);
        const combined = haystack.join(' ');
        let score = 0;

        for (const token of rawTokens) {
          // exact whole-word match in any attribute
          const wordRe = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (wordRe.test(combined)) score += 5;
          else if (combined.includes(token)) score += 2; // loose substring
        }

        // Strong tokens (from #id / [name] / [data-testid]) weigh much more.
        for (const st of strongTokens) {
          const stNorm = st.replace(/[-_]/g, ' ');
          if ((el.id || '').toLowerCase() === st) score += 20;
          else if ((el.getAttribute('name') || '').toLowerCase() === st) score += 18;
          else if ((el.getAttribute('data-testid') || '').toLowerCase() === st) score += 18;
          else if (combined.includes(stNorm)) score += 6;
        }

        if (score > (best?.score || 0)) {
          const label = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.tagName).trim().slice(0, 40);
          best = { el, score, label };
        }
      }

      if (!best || best.score < 4) return null;

      // Build a stable, unique selector for the winning element.
      const el = best.el as HTMLElement;
      const buildSelector = (node: HTMLElement): string => {
        if (node.id) return `#${CSS.escape(node.id)}`;
        const testid = node.getAttribute('data-testid');
        if (testid) return `[data-testid="${testid}"]`;
        const name = node.getAttribute('name');
        if (name) return `${node.tagName.toLowerCase()}[name="${name}"]`;
        // Fall back to tag + first class + :nth-of-type for uniqueness.
        const tag = node.tagName.toLowerCase();
        const firstClass = typeof node.className === 'string' && node.className.trim()
          ? '.' + CSS.escape(node.className.trim().split(/\s+/)[0])
          : '';
        const base = `${tag}${firstClass}`;
        const parent = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (sameTag.length > 1) {
            const idx = sameTag.indexOf(node) + 1;
            return `${base}:nth-of-type(${idx})`;
          }
        }
        return base;
      };

      return { selector: buildSelector(el), score: best.score, label: best.label };
    },
    { sel: brokenSelector, mode }
  ).catch(() => null);

  return result;
}

/**
 * Resolves the target execution context to a page or iframe frame.
 * Returns the context and optional frameInfo for logging.
 */
export async function resolveIframe(
  page: any,
  iframe: number | undefined,
  iframeSelector: string | undefined,
  toolName: string
): Promise<{ context: any; frameInfo: Record<string, unknown> | null }> {
  if (iframe === undefined && !iframeSelector) return { context: page, frameInfo: null };

  const resolved = await helpersHandlers._resolveIframeContext(page, iframe, iframeSelector);
  if (resolved.success) {
    notifyProgress(toolName, 'progress', `Switched to iframe ${iframe ?? iframeSelector}`);
    return { context: resolved.targetFrame, frameInfo: resolved.frameInfo };
  }
  notifyProgress(toolName, 'progress', `Warning: Could not switch to iframe - ${resolved.error}`);
  return { context: page, frameInfo: null };
}

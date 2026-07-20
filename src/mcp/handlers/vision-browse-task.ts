import { requireBrowser, notifyProgress } from './state';
import { domHandlers } from './dom';
import { browserHandlers } from './browser';
import { extractHandlers } from './extract';
import { seePage } from './vision-see-page';

/**
 * browse_task — Human-like continuous workflow runner.
 *
 * Runs a list of browsing steps (click / type / press_key / scroll / wait /
 * extract / see) back-to-back in a SINGLE flow, WITHOUT pausing for a
 * screenshot between steps. The AI agent plans the whole task from one
 * see_page view, then hands the step list here.
 *
 * No LLM is used inside this tool — it simply orchestrates the existing
 * primitive handlers (click/type/etc.) in order. This keeps the MCP server
 * LLM-free while enabling a continuous, human-style action sequence.
 */

type StepResult = { step: number; action: string; success: boolean; result?: any; error?: string };

function detectStepError(res: any): string | null {
  if (!res) return 'no result';
  if (res.success === false) return res.error || 'step failed';
  return null;
}

export async function browseTask(params: any = {}) {
  const { page } = requireBrowser();
  const {
    steps = [],
    captureBefore = true,
    captureAfter = true,
    stopOnError = true,
  } = params;

  if (!Array.isArray(steps) || steps.length === 0) {
    return { success: false, error: 'steps array is required and must be non-empty' };
  }

  notifyProgress('browse_task', 'started', `🧭 Running ${steps.length} steps in one continuous flow...`);

  let beforeImage: string | null = null;
  if (captureBefore) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
      beforeImage = Buffer.from(buf).toString('base64');
    } catch { /* ignore */ }
  }

  const results: StepResult[] = [];
  let failed = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] || {};
    const action = step.action;
    notifyProgress('browse_task', 'progress', `Step ${i + 1}/${steps.length}: ${action}`);

    let res: any = null;
    let err: string | null = null;
    let stepSuccess = false;
    
    // Step-level retry logic (max 3 attempts per step) to make task execution 100% robust
    const maxAttempts = 3;
    
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
              key: step.key,
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
          break; // Success, exit retry loop
        }
      } catch (e: any) {
        err = e?.message || String(e);
      }
      
      if (attempt < maxAttempts) {
        notifyProgress('browse_task', 'warn', `Step ${i + 1} failed: ${err}. Retrying (${attempt}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, 1500)); // wait before retry
      }
    }

    if (!stepSuccess) {
      results.push({ step: i + 1, action, success: false, error: err || 'Unknown error' });
      failed = true;
      if (stopOnError) {
        notifyProgress('browse_task', 'error', `Step ${i + 1} failed after ${maxAttempts} attempts: ${err}. Stopping sequence.`);
        break;
      }
    } else {
      results.push({ step: i + 1, action, success: true, result: res });
    }
  }

  let afterImage: string | null = null;
  if (captureAfter) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
      afterImage = Buffer.from(buf).toString('base64');
    } catch { /* ignore */ }
  }

  notifyProgress('browse_task', 'completed', `🧭 Completed ${results.length}/${steps.length} steps`);

  const mcpContent: any[] = [];
  if (beforeImage) {
    mcpContent.push({ type: 'image', data: beforeImage, mimeType: 'image/jpeg' });
  }
  if (afterImage) {
    mcpContent.push({ type: 'image', data: afterImage, mimeType: 'image/jpeg' });
  }
  mcpContent.push({
    type: 'text',
    text: `Browse task finished. Steps executed: ${results.length}/${steps.length}.\n${JSON.stringify(
      results.map(r => ({ step: r.step, action: r.action, success: r.success, error: r.error || undefined })),
      null, 2
    )}`,
  });

  return {
    success: !failed,
    successCount: results.filter(r => r.success).length,
    totalSteps: steps.length,
    mcpContent,
  };
}

// Handler aggregation hub
import { browserHandlers } from './browser';
import { domHandlers } from './dom';
import { networkHandlers } from './network';
import { visionHandlers } from './vision';
import { extractHandlers } from './extract';
import { utilityHandlers } from './utility-handlers';
import { mediaHandlers } from './media-handlers';
import { state, setProgressCallback, notifyProgress, getHeadlessFromEnv, getState, requireBrowser, detachNetworkRecorderListeners } from './state';
import { validateToolArgs, invalidArgsResult } from '../../shared/validate';
import { logger } from '../../shared/logger';

// TOOLS uses module.exports (CJS), so it is not an ES export.
const { TOOLS } = require('../../shared/tools') as { TOOLS: any[] };

// Public tool handlers only — internal helpers (_fillFormFields etc.) are NOT exposed
export const handlers: any = {
  ...browserHandlers,
  ...domHandlers,
  ...networkHandlers,
  ...visionHandlers,
  ...extractHandlers,
  ...utilityHandlers,
  ...mediaHandlers
};

// Global watchdog: no tool handler may block the MCP request forever.
// If a browser page crashed / became stale, handlers that awaited page calls
// would otherwise hang indefinitely and the MCP client would report
// "-32001 Request timed out". Racing each handler against a hard timeout
// guarantees the server always answers promptly.
const TOOL_TIMEOUT_MS = parseInt(process.env.REAL_BROWSER_TOOL_TIMEOUT_MS || '120000', 10);
// Long-lived tools (network_recorder, media batch jobs, async JS) still get a
// generous hard budget so a crashed browser can never hang the server forever.
const LONG_TOOL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function withWatchdog<T>(name: string, promise: Promise<T>, budgetMs: number = TOOL_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const watchdog = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${budgetMs}ms`)), budgetMs);
  });
  // Clear the timer when the race settles so a finished tool call does not
  // keep the event loop alive (or fire a stray rejection) for the full budget.
  return Promise.race<T>([promise, watchdog]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Some tools (network_recorder, progress_tracker, media_extractor, execute_js)
// are legitimately long-lived and get the larger 5-minute budget above.
const LONG_RUNNING_TOOLS = new Set([
  'network_recorder',
  'progress_tracker',
  'media_extractor',
  'execute_js',
]);

// ───────────────────────────────────────────────────────────────────────────
// Tool serialization
//
// The MCP server can receive concurrent tools/call requests. Because every
// tool operates on ONE shared browser page, overlapping handlers would
// interleave actions on the same page (double clicks, torn state). Worse,
// when the watchdog fires, the timed-out handler keeps running underneath
// and could collide with the NEXT tool call.
//
// A simple promise chain serializes execution: each tool waits for the
// previous one to settle (success, error, or watchdog timeout) before
// touching the browser. The watchdog on every handler guarantees the chain
// can never deadlock.
// ───────────────────────────────────────────────────────────────────────────
let executionChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = executionChain.then(fn);
  // Swallow so a rejected link never poisons the chain for later calls.
  executionChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function executeTool(name: string, args: any = {}) {
  if (handlers[name]) {
    // Validate args against the registered schema before dispatching. Returns
    // a clean, machine-readable error instead of a raw handler crash when the
    // LLM omits required params or passes wrong types.
    try {
      const toolDef = TOOLS.find((t: any) => t.name === name);
      const validation = validateToolArgs(toolDef?.inputSchema, args || {});
      if (!validation.valid) {
        return invalidArgsResult(name, validation);
      }
    } catch (e) {
      // Validation itself must never block tool execution.
    }
    const startedAt = Date.now();
    try {
      // Long-running tools still get a generous hard budget (5 min) so a
      // crashed page can never hang the server forever.
      const result: any = await serialize(() => {
        const handlerCall = handlers[name](args);
        return LONG_RUNNING_TOOLS.has(name)
          ? withWatchdog(name, handlerCall, LONG_TOOL_TIMEOUT_MS)
          : withWatchdog(name, handlerCall);
      });
      // Structured per-call log line — the minimal observability signal for
      // production monitoring (tool, duration, outcome).
      logger.info('tool_call', {
        tool: name,
        durationMs: Date.now() - startedAt,
        success: result?.success !== false,
      });
      // Guarantee a well-formed response even if a handler returns undefined/non-object
      if (!result || typeof result !== 'object') {
        return { success: true, result };
      }
      return result;
    } catch (error: any) {
      logger.error('tool_call', {
        tool: name,
        durationMs: Date.now() - startedAt,
        success: false,
        error: error?.message || String(error),
      });
      return { success: false, error: error?.message || String(error) };
    }
  }
  return { success: false, error: `Tool ${name} not implemented` };
}

export async function cleanup() {
  // Release page-level resources BEFORE closing the browser so event
  // listeners never fire against a half-dead page.
  try {
    detachNetworkRecorderListeners();
  } catch { /* ignore */ }
  state.isRecordingNetwork = false;

  if (state.browserInstance) {
    // Reuse the same close logic as browser_close handler
    try {
      await state.browserInstance.close();
    } catch (e) {
      if (typeof (state.browserInstance as any).process === 'function') {
        (state.browserInstance as any).process()?.kill('SIGKILL');
      }
    }
    state.browserInstance = null;
    state.pageInstance = null;
    state.blockerInstance = null;
    state.setupPageFn = null;
  }

  // Reset all session-scoped state so a fresh browser_init starts clean.
  state.networkRecords = [];
  state.networkRecorderBoundPage = null;
  state.networkRecorderListeners = null;
  state.activeAnnotations = undefined;
  state.progressTasks = {};
}

export { getState, requireBrowser, setProgressCallback, notifyProgress, getHeadlessFromEnv };

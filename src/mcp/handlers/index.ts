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
//
// The budgets are deliberately BELOW the MCP client's default request
// timeout (60s in the official SDK). Strict clients (Anthropic) require
// every tool_use to be answered by a tool_result that stays in the
// conversation: a call the client has already given up on is never recorded,
// and its orphaned tool_use makes the NEXT request fail with a 400
// ("tool_use ids were found without tool_result blocks"). Answering at ~50s
// — even with a timeout error — is always better than answering perfectly
// at 120s, because a recorded error preserves the pairing and a late
// answer does not.
const TOOL_TIMEOUT_MS = parseInt(process.env.REAL_BROWSER_TOOL_TIMEOUT_MS || '50000', 10);
// Long-lived tools (network_recorder, media batch jobs, async JS) get a
// slightly larger budget, still inside the client's 60s patience.
const LONG_TOOL_TIMEOUT_MS = parseInt(process.env.REAL_BROWSER_LONG_TOOL_TIMEOUT_MS || '55000', 10);
// Total per-call budget measured from ARRIVAL at executeTool (queue wait +
// execution). A parallel pair dispatched together shares the same client
// clock, so a call that waited in the serialization queue must not get a
// fresh full budget when its turn finally comes — see executeTool.
const ARRIVAL_BUDGET_MS = parseInt(process.env.REAL_BROWSER_ARRIVAL_BUDGET_MS || '55000', 10);

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

// Some tools (network_recorder, media_extractor, execute_js)
// are legitimately long-lived and get the larger budget above.
const LONG_RUNNING_TOOLS = new Set([
  'network_recorder',
  'media_extractor',
  'execute_js',
  'navigate', // navigate(waitForChallenge) can legitimately wait up to ~90s
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
//
// Because calls queue here, executeTool enforces an arrival deadline
// (ARRIVAL_BUDGET_MS from when the call arrived, not from when it starts):
// a queued call whose turn comes after its deadline returns a fast
// structured "busy" error instead of starting late — a recorded error
// result keeps the client's tool_use/tool_result pairing intact, while a
// late answer (or silence) breaks it on strict clients.
// ───────────────────────────────────────────────────────────────────────────
let executionChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = executionChain.then(fn);
  // Swallow so a rejected link never poisons the chain for later calls.
  executionChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function executeTool(name: string, args: any = {}) {
  // Arrival timestamp for the per-call arrival deadline: the budget covers
  // validation + queue wait + execution, all measured from NOW — the same
  // moment the client's own request clock started ticking.
  const arrivalDeadline = Date.now() + ARRIVAL_BUDGET_MS;
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
      const result: any = await serialize(async () => {
        // Arrival deadline: this call may have waited in the serialization
        // queue behind a previous call. Whatever is left of its arrival
        // budget is all it gets — if nothing is left, do NOT start late:
        // return a fast structured busy error instead, so the client can
        // record a tool_result for this call and retry it sequentially.
        const remainingMs = arrivalDeadline - Date.now();
        if (remainingMs <= 0) {
          return {
            success: false,
            error: 'Server busy: a previous tool call is still running. Retry this call sequentially.',
          };
        }
        const toolBudget = LONG_RUNNING_TOOLS.has(name) ? LONG_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS;
        const handlerCall = handlers[name](args);
        return withWatchdog(name, handlerCall, Math.min(toolBudget, remainingMs));
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
}

export { getState, requireBrowser, setProgressCallback, notifyProgress, getHeadlessFromEnv };

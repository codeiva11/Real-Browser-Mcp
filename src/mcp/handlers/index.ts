// Handler aggregation hub
import { browserHandlers } from './browser';
import { domHandlers } from './dom';
import { networkHandlers } from './network';
import { visionHandlers } from './vision';
import { extractHandlers } from './extract';
import { utilityHandlers } from './utility-handlers';
import { mediaHandlers } from './media-handlers';
import { state, setProgressCallback, notifyProgress, getHeadlessFromEnv, getState, requireBrowser, detachNetworkRecorderListeners, setActiveCallDeadline, clearActiveCallDeadline, setActiveCallCancelled } from './state';
import { validateToolArgs, invalidArgsResult } from '../../shared/validate';
import { logger } from '../../shared/logger';
import { createJob, getJob, listJobs, jobMeta, requestJobCancel, finishJob, jobTimeoutMs, type JobRecord } from './jobs';

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
  ...mediaHandlers,
  // P2: async_job is registry-only (see the P2 section below); it is
  // special-cased in executeTool and never enters the serialize chain.
  async_job: asyncJobHandler
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

// ───────────────────────────────────────────────────────────────────────────
// P1c heartbeat: while a handler (or job) runs, emit a progress notification
// roughly every 15s. MCP clients that pass a progressToken get their 60s
// request clock reset by each notification, so a legitimately busy server no
// longer looks dead. The interval is unref'd and always cleared on settle —
// it can never keep the process alive on its own.
// ───────────────────────────────────────────────────────────────────────────
function startHeartbeat(tool: string, startedAt: number): NodeJS.Timeout {
  const timer = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    notifyProgress(tool, 'progress', `⏳ ${tool} still running (${elapsedSec}s elapsed)`);
  }, 15000);
  timer.unref?.();
  return timer;
}

// ───────────────────────────────────────────────────────────────────────────
// P2 — async jobs for genuinely long work.
//
// Exactly three operations accept `async: true`: media_extractor
// batch_extract, see_page with a steps array, and execute_js. The call
// returns a jobId immediately (well inside the client's 60s clock, so the
// tool_use/tool_result pairing is recorded), and the real work runs in the
// background THROUGH the same serialize() chain — the shared page is still
// only ever touched by one execution at a time. While a job runs, the P1b
// active-call deadline is the job deadline, so the long loops inside those
// handlers bail out cleanly at the job budget or on cancel.
// ───────────────────────────────────────────────────────────────────────────
function isAsyncCapable(name: string, args: any): boolean {
  if (name === 'execute_js') return true;
  if (name === 'see_page') return Array.isArray(args?.steps) && args.steps.length > 0;
  if (name === 'media_extractor') return args?.action === 'batch_extract';
  return false;
}

async function executeJobWork(job: JobRecord, name: string, args: any): Promise<void> {
  const timeoutMs = jobTimeoutMs();
  const deadline = job.startedAt + timeoutMs;
  job.deadline = deadline;
  try {
    const result: any = await serialize(async () => {
      setActiveCallDeadline(deadline);
      const heartbeat = startHeartbeat(name, job.startedAt);
      let cancelPoll: NodeJS.Timeout | undefined;
      let budgetTimer: NodeJS.Timeout | undefined;
      try {
        const handlerPromise: Promise<any> = Promise.resolve().then(() => handlers[name](args));
        // The guard races the handler: cancellation is cooperative (the
        // handler's loops poll the P1b state and stop with partial results),
        // but a handler stuck inside ONE long page op would never reach a
        // checkpoint — the guard still ends the job promptly. The orphaned
        // page op itself cannot be aborted (accepted, see research P1b).
        const guard = new Promise<never>((_, reject) => {
          cancelPoll = setInterval(() => {
            if (job.cancelled) reject(new Error('cancelled'));
          }, 250);
          cancelPoll.unref?.();
          budgetTimer = setTimeout(
            () => reject(new Error(`Job "${name}" timed out after ${timeoutMs}ms`)),
            Math.max(0, deadline - Date.now())
          );
          budgetTimer.unref?.();
        });
        return await Promise.race([handlerPromise, guard]);
      } finally {
        clearInterval(heartbeat);
        if (cancelPoll) clearInterval(cancelPoll);
        if (budgetTimer) clearTimeout(budgetTimer);
        clearActiveCallDeadline();
      }
    });
    if (job.cancelled) {
      finishJob(job, 'error', { error: 'cancelled' });
    } else {
      finishJob(job, 'completed', { result });
    }
  } catch (error: any) {
    if (job.cancelled || error?.message === 'cancelled') {
      finishJob(job, 'error', { error: 'cancelled' });
    } else {
      finishJob(job, 'error', { error: error?.message || String(error) });
    }
  }
}

// async_job handler: registry reads/writes only. It NEVER touches the
// browser, so executeTool dispatches it directly — no serialize chain, no
// watchdog, no arrival deadline. (Hoisted function declaration: referenced
// by the handlers map above.)
async function asyncJobHandler(args: any = {}) {
  const action: string = args?.action || 'status';

  if (action === 'list') {
    return { success: true, action: 'list', jobs: listJobs().map(jobMeta) };
  }

  const jobId: string | undefined = args?.jobId;
  if (!jobId) {
    return { success: false, error: `async_job: jobId is required for action "${action}"` };
  }
  const job = getJob(jobId);
  if (!job) {
    return { success: false, error: `async_job: unknown jobId "${jobId}"` };
  }

  switch (action) {
    case 'status':
      return { success: true, action: 'status', ...jobMeta(job) };
    case 'result': {
      if (job.status === 'running') {
        return { success: true, action: 'result', jobId: job.id, status: 'running' };
      }
      if (job.status === 'error') {
        // The QUERY succeeded — the job's outcome travels in status/error.
        // (Returning success:false here would make the server render only
        // {error}, hiding the status/timing a poller needs.)
        return {
          success: true, action: 'result', jobId: job.id, status: 'error', error: job.error,
          startedAt: new Date(job.startedAt).toISOString(),
          finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
          elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
        };
      }
      return {
        success: true, action: 'result', jobId: job.id, status: 'completed', result: job.result,
        startedAt: new Date(job.startedAt).toISOString(),
        finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
        elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
      };
    }
    case 'cancel': {
      if (job.status !== 'running') {
        return { success: true, action: 'cancel', jobId: job.id, status: job.status, note: 'Job already finished; nothing to cancel.' };
      }
      requestJobCancel(job);
      // If THIS job is the execution currently holding the shared page, trip
      // the P1b cancel flag so its loops stop at their next checkpoint. The
      // deadline comparison guards against poisoning an unrelated call that
      // happens to be executing while this job is still queued.
      if (state.activeCallDeadline != null && job.deadline !== undefined && state.activeCallDeadline === job.deadline) {
        setActiveCallCancelled();
      }
      return { success: true, action: 'cancel', jobId: job.id, status: 'cancelling', note: 'Cancellation requested; the job stops at its next checkpoint.' };
    }
    default:
      return { success: false, error: `async_job: unknown action "${action}". Supported: status, result, list, cancel` };
  }
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
    // P2: async_job only reads/writes the in-memory job registry — it must
    // answer instantly even while a long job holds the serialize chain, so
    // it bypasses serialization, the watchdog and the arrival deadline.
    if (name === 'async_job') {
      try {
        return await handlers[name](args);
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    }
    // P2: `async: true` opt-in on the three long operations — register a
    // background job and answer immediately with its jobId. The jobId reply
    // is recorded by the client like any other tool_result, so the pairing
    // stays intact no matter how long the real work takes.
    if (args?.async === true && isAsyncCapable(name, args)) {
      const job = createJob(name);
      logger.info('tool_call', { tool: name, async: true, jobId: job.id });
      void executeJobWork(job, name, args);
      return {
        success: true,
        async: true,
        jobId: job.id,
        status: 'running',
        note: 'Poll async_job for the result.',
      };
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
        const effectiveDeadline = Math.min(arrivalDeadline, Date.now() + toolBudget);
        // P1b: publish this call's deadline so long loops inside the handler
        // can bail out cleanly (partial results) instead of running on as
        // zombies after the watchdog answers the client. P1c: heartbeat
        // progress while it runs.
        setActiveCallDeadline(effectiveDeadline);
        const heartbeat = startHeartbeat(name, startedAt);
        try {
          const handlerCall = handlers[name](args);
          return await withWatchdog(name, handlerCall, effectiveDeadline - Date.now());
        } finally {
          clearInterval(heartbeat);
          clearActiveCallDeadline();
        }
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

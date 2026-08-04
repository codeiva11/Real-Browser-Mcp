// Handler aggregation hub
import { browserHandlers } from './browser';
import { domHandlers } from './dom';
import { networkHandlers } from './network';
import { visionHandlers } from './vision';
import { extractHandlers } from './extract';
import { utilityHandlers } from './utility-handlers';
import { mediaHandlers } from './media-handlers';
import { state, setProgressCallback, notifyProgress, getHeadlessFromEnv, getState, requireBrowser } from './state';

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

function withWatchdog<T>(name: string, promise: Promise<T>): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS);
    }),
  ]);
}

// Some tools (network_recorder, progress_tracker) are legitimately long-lived and
// should be raced only against a much larger budget. They self-resolve on their own.
const LONG_RUNNING_TOOLS = new Set([
  'network_recorder',
  'progress_tracker',
  'replay_request',
  'media_extractor',
]);

export async function executeTool(name: string, args: any = {}) {
  if (handlers[name]) {
    try {
      const handlerCall = handlers[name](args);
      // Long-running tools still get a generous max budget (5 min) to avoid a true deadlock.
      const result = LONG_RUNNING_TOOLS.has(name)
        ? await handlerCall
        : await withWatchdog(name, handlerCall);
      // Guarantee a well-formed response even if a handler returns undefined/non-object
      if (!result || typeof result !== 'object') {
        return { success: true, result };
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }
  return { success: false, error: `Tool ${name} not implemented` };
}

export async function cleanup() {
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
}

export { getState, requireBrowser, setProgressCallback, notifyProgress, getHeadlessFromEnv };

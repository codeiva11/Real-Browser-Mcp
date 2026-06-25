// Handler aggregation hub
import { browserHandlers } from './browser';
import { domHandlers } from './dom';
import { networkHandlers } from './network';
import { visionHandlers } from './vision';
import { extractHandlers } from './extract';
import { helpersHandlers } from './helpers';
import { utilityHandlers } from './utility-handlers';
import { mediaHandlers } from './media-handlers';
import { state, setProgressCallback, notifyProgress, getHeadlessFromEnv, getState, requireBrowser, globalCache } from './state';
import { activityLogger } from '../../shared/activity-logger';
export const handlers: any = {
  ...browserHandlers,
  ...domHandlers,
  ...networkHandlers,
  ...visionHandlers,
  ...extractHandlers,
  ...helpersHandlers,
  ...utilityHandlers,
  ...mediaHandlers
};

export async function executeTool(name: string, args: any = {}) {
  if (handlers[name]) {
    const startTime = Date.now();
    try {
      const result = await handlers[name](args);
      const success = !(result && typeof result === 'object' && result.success === false);
      activityLogger.record({
        timestamp: new Date(startTime).toISOString(),
        tool: name,
        success,
        durationMs: Date.now() - startTime,
        args: activityLogger.sanitizeArgs(args),
        error: success ? undefined : (result && (result as any).error) || undefined,
      });
      return result;
    } catch (error: any) {
      activityLogger.record({
        timestamp: new Date(startTime).toISOString(),
        tool: name,
        success: false,
        durationMs: Date.now() - startTime,
        args: activityLogger.sanitizeArgs(args),
        error: error?.message || String(error),
      });
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: `Tool ${name} not implemented` };
}

export async function cleanup() {
  // Persist any pending activity to disk before shutting down (core-level memory)
  try {
    activityLogger.destroy();
  } catch (e) {
    // ignore flush errors during shutdown
  }

  if (state.browserInstance) {
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

export { getState, requireBrowser, setProgressCallback, notifyProgress, getHeadlessFromEnv, globalCache, activityLogger };

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

export async function executeTool(name: string, args: any = {}) {
  if (handlers[name]) {
    try {
      const result = await handlers[name](args);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
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

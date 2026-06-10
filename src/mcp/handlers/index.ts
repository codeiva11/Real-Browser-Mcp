// Handler aggregation hub
import { browserHandlers } from './browser';
import { domHandlers } from './dom';
import { networkHandlers } from './network';
import { visionHandlers } from './vision';
import { extractHandlers } from './extract';
import { helpersHandlers } from './helpers';
import { utilityHandlers } from './utility-handlers';
import { mediaHandlers } from './media-handlers';
import { formHandlers } from './form-handlers';
import { state, setProgressCallback, notifyProgress, getHeadlessFromEnv, getState, requireBrowser, globalCache } from './state';
export const handlers: any = {
  ...browserHandlers,
  ...domHandlers,
  ...networkHandlers,
  ...visionHandlers,
  ...extractHandlers,
  ...helpersHandlers,
  ...utilityHandlers,
  ...mediaHandlers,
  ...formHandlers
};

export async function executeTool(name: string, args: any = {}) {
  if (handlers[name]) {
    try {
      return await handlers[name](args);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: `Tool ${name} not implemented` };
}

export async function cleanup() {
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

export { getState, requireBrowser, setProgressCallback, notifyProgress, getHeadlessFromEnv, globalCache };

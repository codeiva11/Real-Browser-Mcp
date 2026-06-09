// @ts-nocheck
import { browserHandlers } from './browser';
import { domHandlers } from './dom';
import { networkHandlers } from './network';
import { visionHandlers } from './vision';
import { extractHandlers } from './extract';
import { helpersHandlers } from './helpers';
import { miscHandlers } from './misc';
import { state, setProgressCallback, notifyProgress, getHeadlessFromEnv, getState, requireBrowser } from './state';
import { getAICore, aiEnhancedSelector } from '../../ai/core';

export const handlers: any = {
  ...browserHandlers,
  ...domHandlers,
  ...networkHandlers,
  ...visionHandlers,
  ...extractHandlers,
  ...helpersHandlers,
  ...miscHandlers
};

export async function executeTool(name: string, args: any = {}) {
  if (handlers[name]) {
    try {
      const aiCore = getAICore ? getAICore() : null;
      let wrappedHandler = handlers[name];
      if (aiCore && typeof aiCore.wrapHandler === 'function') {
        wrappedHandler = aiCore.wrapHandler(handlers[name].bind(handlers), name);
      }
      return await wrappedHandler(args);
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
      if (typeof state.browserInstance.process === 'function') {
        state.browserInstance.process()?.kill('SIGKILL');
      }
    }
    state.browserInstance = null;
    state.pageInstance = null;
    state.blockerInstance = null;
    state.setupPageFn = null;
  }
}

export { getState, requireBrowser, setProgressCallback, notifyProgress, getHeadlessFromEnv, getAICore, aiEnhancedSelector };

import { notifyProgress } from './state';

export interface IframeResult {
  context: any;
  frameInfo: Record<string, unknown> | null;
}

export async function resolveIframe(page: any, iframe: number | undefined, iframeSelector: string | undefined, toolName: string): Promise<IframeResult> {
  if (iframe === undefined && !iframeSelector) return { context: page, frameInfo: null };

  const { helpersHandlers } = require('./helpers');
  const resolved = await helpersHandlers._resolveIframeContext(page, iframe, iframeSelector);
  if (resolved.success) {
    notifyProgress(toolName, 'progress', `Switched to iframe ${iframe ?? iframeSelector}`);
    return { context: resolved.targetFrame, frameInfo: resolved.frameInfo };
  }
  notifyProgress(toolName, 'progress', `Warning: Could not switch to iframe - ${resolved.error}`);
  return { context: page, frameInfo: null };
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, retries: number, toolName: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        notifyProgress(toolName, 'progress', `Attempt ${attempt} failed: ${lastError.message}, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  throw lastError || new Error('All retries exhausted');
}

export function ok(data: Record<string, unknown>) {
  return { success: true, ...data };
}

export function fail(error: string, extra?: Record<string, unknown>) {
  return { success: false, error, ...extra };
}

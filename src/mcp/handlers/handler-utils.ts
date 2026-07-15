import { notifyProgress } from './state';
import { helpersHandlers } from './helpers';

/**
 * Resolves the target execution context to a page or iframe frame.
 * Returns the context and optional frameInfo for logging.
 */
export async function resolveIframe(
  page: any,
  iframe: number | undefined,
  iframeSelector: string | undefined,
  toolName: string
): Promise<{ context: any; frameInfo: Record<string, unknown> | null }> {
  if (iframe === undefined && !iframeSelector) return { context: page, frameInfo: null };

  const resolved = await helpersHandlers._resolveIframeContext(page, iframe, iframeSelector);
  if (resolved.success) {
    notifyProgress(toolName, 'progress', `Switched to iframe ${iframe ?? iframeSelector}`);
    return { context: resolved.targetFrame, frameInfo: resolved.frameInfo };
  }
  notifyProgress(toolName, 'progress', `Warning: Could not switch to iframe - ${resolved.error}`);
  return { context: page, frameInfo: null };
}

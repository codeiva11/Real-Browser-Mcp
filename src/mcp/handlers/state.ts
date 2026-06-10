import * as crypto from 'crypto';
import * as path from 'path';
import { CacheManager } from '../../shared/cache-manager';
import type {
  BrowserState,
  ProgressStatus,
  ProgressNotification,
  ProgressCallback,
  DecodeResult,
  AESDecryptResult,
} from '../../types';

export const state: BrowserState = {
  browserInstance: null,
  pageInstance: null,
  blockerInstance: null,
  setupPageFn: null,
  networkRecords: [],
  isRecordingNetwork: false,
  progressTasks: {},
  progressCallback: null
};

// Global cache instance for persistent storage across server restarts
export const globalCache = new CacheManager({
  cacheDir: path.join(process.cwd(), '.cache'),
  autoSaveInterval: 30000,
});

export function setProgressCallback(callback: ProgressCallback): void {
  state.progressCallback = callback;
}

export function notifyProgress(
  toolName: string,
  status: ProgressStatus,
  message: string,
  data: Record<string, unknown> = {}
): ProgressNotification {
  const notification: ProgressNotification = {
    tool: toolName,
    status,
    message,
    timestamp: new Date().toISOString(),
    ...data
  };

  const emoji: Record<string, string> = {
    started: '🚀',
    progress: '⏳',
    completed: '✅',
    error: '❌'
  };
  const icon = emoji[status] || '📌';

  console.error(`${icon} [${toolName}] ${message}`);

  if (state.progressCallback) {
    state.progressCallback(notification);
  }

  return notification;
}

export function getHeadlessFromEnv(): boolean {
  const envHeadless = process.env.HEADLESS;

  if (envHeadless !== undefined && envHeadless !== null && envHeadless !== '') {
    const value = envHeadless.toLowerCase().trim();
    return value === 'true' || value === '1' || value === 'yes';
  }

  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.TRAVIS || process.env.CIRCLECI) {
    return true;
  }

  if (process.platform === 'linux') {
    const hasDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
    if (!hasDisplay) {
      return true;
    }
  }

  return false;
}

export function getState() {
  return { browser: state.browserInstance, page: state.pageInstance, blocker: state.blockerInstance };
}

export function requireBrowser() {
  if (!state.browserInstance || !state.pageInstance) {
    throw new Error('Browser not initialized. Call browser_init first.');
  }
  return { browser: state.browserInstance, page: state.pageInstance };
}

export function resolveWaitUntil(value: string): string {
  const allowed = ['load', 'domcontentloaded', 'networkidle', 'commit'];
  return allowed.includes(value) ? value : 'networkidle';
}

export const decoders = {
  urlDecode: (encodedUrl: string): DecodeResult => {
    try {
      let decoded = encodedUrl;
      let iterations = 0;
      const maxIterations = 5;

      while (iterations < maxIterations) {
        const newDecoded = decodeURIComponent(decoded);
        if (newDecoded === decoded) break;
        decoded = newDecoded;
        iterations++;
      }

      return { success: true, decoded, iterations, original: encodedUrl };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg, original: encodedUrl };
    }
  },

  base64Decode: (encodedData: string): DecodeResult => {
    try {
      const approaches: Array<{ method: string; decoded: string }> = [];
      try {
        const decoded = Buffer.from(encodedData, 'base64').toString('utf-8');
        if (decoded && decoded !== encodedData) {
          approaches.push({ method: 'standard', decoded });
        }
      } catch (_e) { /* ignore */ }

      try {
        const normalized = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(normalized, 'base64').toString('utf-8');
        if (decoded && decoded !== encodedData) {
          approaches.push({ method: 'url-safe', decoded });
        }
      } catch (_e) { /* ignore */ }

      try {
        const padding = 4 - (encodedData.length % 4);
        if (padding !== 4) {
          const padded = encodedData + '='.repeat(padding);
          const decoded = Buffer.from(padded, 'base64').toString('utf-8');
          if (decoded && decoded !== encodedData) {
            approaches.push({ method: 'padded', decoded });
          }
        }
      } catch (_e) { /* ignore */ }

      if (approaches.length === 0) {
        return { success: false, error: 'Could not decode base64', original: encodedData };
      }

      return { success: true, decoded: approaches[0].decoded, approaches, original: encodedData };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg, original: encodedData };
    }
  },

  decryptAES: (
    encryptedData: string | Buffer,
    key: string | Buffer,
    iv: string | Buffer | null = null,
    algorithm: string = 'aes-256-cbc'
  ): AESDecryptResult => {
    try {
      const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf-8');
      let encryptedBuffer: Buffer;
      if (Buffer.isBuffer(encryptedData)) {
        encryptedBuffer = encryptedData;
      } else if (typeof encryptedData === 'string' && encryptedData.includes('%')) {
        encryptedBuffer = Buffer.from(decodeURIComponent(encryptedData), 'base64');
      } else {
        encryptedBuffer = Buffer.from(encryptedData as string, 'base64');
      }

      let decipher: crypto.Decipheriv;
      if (iv) {
        const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'utf-8');
        decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);
      } else {
        decipher = crypto.createDecipheriv(algorithm.replace('-cbc', '-ecb'), keyBuffer, Buffer.alloc(0));
      }

      let decrypted = decipher.update(encryptedBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      const result = decrypted.toString('utf-8');
      return { success: true, decrypted: result, algorithm };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg, algorithm };
    }
  },

  tryAll: (data: string, options: { key?: string; iv?: string; algorithm?: string } = {}) => {
    const results: { original: string; attempts: Array<{ type: string; result: string | undefined }> } = { original: data, attempts: [] };
    const urlResult = decoders.urlDecode(data);
    if (urlResult.success && urlResult.iterations && urlResult.iterations > 0) results.attempts.push({ type: 'url', result: urlResult.decoded });
    
    const base64Result = decoders.base64Decode(data);
    if (base64Result.success) {
      results.attempts.push({ type: 'base64', result: base64Result.decoded });
      const nestedUrl = decoders.urlDecode(base64Result.decoded!);
      if (nestedUrl.success && nestedUrl.iterations && nestedUrl.iterations > 0) results.attempts.push({ type: 'base64+url', result: nestedUrl.decoded });
    }

    if (options.key) {
      const aesResult = decoders.decryptAES(data, options.key, options.iv || null, options.algorithm);
      if (aesResult.success) results.attempts.push({ type: 'aes', result: aesResult.decrypted });
    }

    return results;
  }
};

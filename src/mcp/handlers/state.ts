// @ts-nocheck
import * as crypto from 'crypto';

export const state: any = {
  browserInstance: null,
  pageInstance: null,
  blockerInstance: null,
  setupPageFn: null,
  networkRecords: [],
  isRecordingNetwork: false,
  progressTasks: {},
  progressCallback: null
};

export function setProgressCallback(callback: any) {
  state.progressCallback = callback;
}

export function notifyProgress(toolName: string, status: string, message: string, data: any = {}) {
  const notification = {
    tool: toolName,
    status,
    message,
    timestamp: new Date().toISOString(),
    ...data
  };

  const emoji: any = {
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

export function getHeadlessFromEnv() {
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

export function resolveWaitUntil(value: string) {
  const allowed = ['load', 'domcontentloaded', 'networkidle', 'commit'];
  return allowed.includes(value) ? value : 'networkidle';
}

export const decoders = {
  urlDecode: (encodedUrl: string) => {
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
    } catch (error: any) {
      return { success: false, error: error.message, original: encodedUrl };
    }
  },

  base64Decode: (encodedData: string) => {
    try {
      const approaches: any[] = [];
      try {
        const decoded = Buffer.from(encodedData, 'base64').toString('utf-8');
        if (decoded && decoded !== encodedData) {
          approaches.push({ method: 'standard', decoded });
        }
      } catch (e) { }

      try {
        const normalized = encodedData.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(normalized, 'base64').toString('utf-8');
        if (decoded && decoded !== encodedData) {
          approaches.push({ method: 'url-safe', decoded });
        }
      } catch (e) { }

      try {
        const padding = 4 - (encodedData.length % 4);
        if (padding !== 4) {
          const padded = encodedData + '='.repeat(padding);
          const decoded = Buffer.from(padded, 'base64').toString('utf-8');
          if (decoded && decoded !== encodedData) {
            approaches.push({ method: 'padded', decoded });
          }
        }
      } catch (e) { }

      if (approaches.length === 0) {
        return { success: false, error: 'Could not decode base64', original: encodedData };
      }

      return { success: true, decoded: approaches[0].decoded, approaches, original: encodedData };
    } catch (error: any) {
      return { success: false, error: error.message, original: encodedData };
    }
  },

  decryptAES: (encryptedData: any, key: any, iv: any = null, algorithm: string = 'aes-256-cbc') => {
    try {
      const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf-8');
      let encryptedBuffer;
      if (Buffer.isBuffer(encryptedData)) {
        encryptedBuffer = encryptedData;
      } else if (typeof encryptedData === 'string' && encryptedData.includes('%')) {
        encryptedBuffer = Buffer.from(decodeURIComponent(encryptedData), 'base64');
      } else {
        encryptedBuffer = Buffer.from(encryptedData, 'base64');
      }

      let decipher;
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
    } catch (error: any) {
      return { success: false, error: error.message, algorithm };
    }
  },

  tryAll: (data: string, options: any = {}) => {
    const results = { original: data, attempts: [] as any[] };
    const urlResult = decoders.urlDecode(data);
    if (urlResult.success && urlResult.iterations > 0) results.attempts.push({ type: 'url', result: urlResult.decoded });
    
    const base64Result = decoders.base64Decode(data);
    if (base64Result.success) {
      results.attempts.push({ type: 'base64', result: base64Result.decoded });
      const nestedUrl = decoders.urlDecode(base64Result.decoded);
      if (nestedUrl.success && nestedUrl.iterations > 0) results.attempts.push({ type: 'base64+url', result: nestedUrl.decoded });
    }

    if (options.key) {
      const aesResult = decoders.decryptAES(data, options.key, options.iv, options.algorithm);
      if (aesResult.success) results.attempts.push({ type: 'aes', result: aesResult.decrypted });
    }

    return results;
  }
};

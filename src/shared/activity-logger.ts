/**
 * Activity Logger — JSON-based persistent activity memory
 *
 * Records every tool call (and its outcome) to a local JSON file so that
 * the full activity history survives server restarts.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ActivityEntry {
  /** Sequential id within the current log file */
  id: number;
  /** ISO timestamp of when the tool call started */
  timestamp: string;
  /** Tool name that was invoked */
  tool: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Duration of the call in milliseconds */
  durationMs: number;
  /** Trimmed summary of the arguments passed to the tool */
  args?: Record<string, unknown>;
  /** Error message if the call failed */
  error?: string;
}

export interface ActivityLoggerConfig {
  /** Directory for the activity log file */
  logDir: string;
  /** Auto-save interval in ms (0 = save immediately on every entry) */
  autoSaveInterval: number;
  /** Maximum number of entries to keep (oldest are pruned) */
  maxEntries: number;
  /** Maximum serialized length for an arg value before it is truncated */
  maxArgLength: number;
}

const DEFAULT_CONFIG: ActivityLoggerConfig = {
  logDir: path.join(process.cwd(), '.cache'),
  autoSaveInterval: 5000, // flush at most every 5s
  maxEntries: 2000,
  maxArgLength: 500,
};

export class ActivityLogger {
  private entries: ActivityEntry[] = [];
  private logFile: string;
  private config: ActivityLoggerConfig;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private nextId = 1;

  constructor(config: Partial<ActivityLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logFile = path.join(this.config.logDir, 'activity_log.json');
    this.loadFromDisk();

    if (this.config.autoSaveInterval > 0) {
      this.saveTimer = setInterval(() => {
        if (this.dirty) this.saveToDisk();
      }, this.config.autoSaveInterval);

      if (this.saveTimer && typeof this.saveTimer.unref === 'function') {
        this.saveTimer.unref();
      }
    }
  }

  /**
   * Record a completed tool call.
   */
  record(entry: Omit<ActivityEntry, 'id'>): ActivityEntry {
    const full: ActivityEntry = { id: this.nextId++, ...entry };
    this.entries.push(full);

    if (this.entries.length > this.config.maxEntries) {
      // Drop oldest entries beyond capacity
      this.entries.splice(0, this.entries.length - this.config.maxEntries);
    }

    this.dirty = true;

    // When auto-save is disabled, persist immediately
    if (this.config.autoSaveInterval === 0) {
      this.saveToDisk();
    }

    return full;
  }

  /**
   * Trim/sanitize an args object so the log stays small and JSON-safe.
   */
  sanitizeArgs(args: unknown): Record<string, unknown> | undefined {
    if (!args || typeof args !== 'object') return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      if (value === undefined || value === null) {
        out[key] = value;
        continue;
      }
      if (typeof value === 'string') {
        out[key] =
          value.length > this.config.maxArgLength
            ? value.slice(0, this.config.maxArgLength) + `…(${value.length} chars)`
            : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
      } else {
        try {
          const serialized = JSON.stringify(value);
          out[key] =
            serialized && serialized.length > this.config.maxArgLength
              ? serialized.slice(0, this.config.maxArgLength) + `…(${serialized.length} chars)`
              : value;
        } catch {
          out[key] = '[unserializable]';
        }
      }
    }
    return out;
  }

  /**
   * Return the most recent `limit` entries (newest last).
   * Optionally filter by tool name.
   */
  getRecent(limit = 50, tool?: string): ActivityEntry[] {
    let list = this.entries;
    if (tool) list = list.filter((e) => e.tool === tool);
    return list.slice(Math.max(0, list.length - limit));
  }

  /**
   * Aggregate statistics across all recorded activity.
   */
  stats(): {
    total: number;
    successes: number;
    failures: number;
    perTool: Record<string, number>;
    logFile: string;
  } {
    const perTool: Record<string, number> = {};
    let successes = 0;
    let failures = 0;
    for (const e of this.entries) {
      perTool[e.tool] = (perTool[e.tool] || 0) + 1;
      if (e.success) successes++;
      else failures++;
    }
    return { total: this.entries.length, successes, failures, perTool, logFile: this.logFile };
  }

  /**
   * Clear all recorded activity.
   */
  clear(): void {
    this.entries = [];
    this.nextId = 1;
    this.dirty = true;
    if (this.config.autoSaveInterval === 0) this.saveToDisk();
  }

  /**
   * Load activity log from disk.
   */
  loadFromDisk(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        const raw = fs.readFileSync(this.logFile, 'utf-8');
        const data: ActivityEntry[] = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.entries = data;
          this.nextId = data.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
          console.error(`📝 [ActivityLogger] Loaded ${this.entries.length} activity entries from disk`);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`⚠️ [ActivityLogger] Failed to load activity log: ${msg}`);
    }
  }

  /**
   * Persist activity log to disk as JSON.
   */
  saveToDisk(): void {
    try {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.logFile, JSON.stringify(this.entries, null, 2), 'utf-8');
      this.dirty = false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`⚠️ [ActivityLogger] Failed to save activity log: ${msg}`);
    }
  }

  /**
   * Cleanup: stop timer and flush final state.
   */
  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.saveToDisk();
  }
}

/** Singleton instance for project-wide use */
export const activityLogger = new ActivityLogger();
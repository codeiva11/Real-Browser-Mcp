"use strict";
/**
 * Activity Logger — JSON-based persistent activity memory
 *
 * Records every tool call (and its outcome) to a local JSON file so that
 * the full activity history survives server restarts.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
})(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityLogger = exports.ActivityLogger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_CONFIG = {
    logDir: path.join(process.cwd(), '.cache'),
    autoSaveInterval: 5000, // flush at most every 5s
    maxEntries: 2000,
    maxArgLength: 500,
};
class ActivityLogger {
    entries = [];
    logFile;
    config;
    saveTimer = null;
    dirty = false;
    nextId = 1;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.logFile = path.join(this.config.logDir, 'activity_log.json');
        this.loadFromDisk();
        if (this.config.autoSaveInterval > 0) {
            this.saveTimer = setInterval(() => {
                if (this.dirty)
                    this.saveToDisk();
            }, this.config.autoSaveInterval);
            if (this.saveTimer && typeof this.saveTimer.unref === 'function') {
                this.saveTimer.unref();
            }
        }
    }
    /**
     * Record a completed tool call.
     */
    record(entry) {
        const full = { id: this.nextId++, ...entry };
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
    sanitizeArgs(args) {
        if (!args || typeof args !== 'object')
            return undefined;
        const out = {};
        for (const [key, value] of Object.entries(args)) {
            if (value === undefined || value === null) {
                out[key] = value;
                continue;
            }
            if (typeof value === 'string') {
                out[key] =
                    value.length > this.config.maxArgLength
                        ? value.slice(0, this.config.maxArgLength) + `…(${value.length} chars)`
                        : value;
            }
            else if (typeof value === 'number' || typeof value === 'boolean') {
                out[key] = value;
            }
            else {
                try {
                    const serialized = JSON.stringify(value);
                    out[key] =
                        serialized && serialized.length > this.config.maxArgLength
                            ? serialized.slice(0, this.config.maxArgLength) + `…(${serialized.length} chars)`
                            : value;
                }
                catch {
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
    getRecent(limit = 50, tool) {
        let list = this.entries;
        if (tool)
            list = list.filter((e) => e.tool === tool);
        return list.slice(Math.max(0, list.length - limit));
    }
    /**
     * Aggregate statistics across all recorded activity.
     */
    stats() {
        const perTool = {};
        let successes = 0;
        let failures = 0;
        for (const e of this.entries) {
            perTool[e.tool] = (perTool[e.tool] || 0) + 1;
            if (e.success)
                successes++;
            else
                failures++;
        }
        return { total: this.entries.length, successes, failures, perTool, logFile: this.logFile };
    }
    /**
     * Clear all recorded activity.
     */
    clear() {
        this.entries = [];
        this.nextId = 1;
        this.dirty = true;
        if (this.config.autoSaveInterval === 0)
            this.saveToDisk();
    }
    /**
     * Load activity log from disk.
     */
    loadFromDisk() {
        try {
            if (fs.existsSync(this.logFile)) {
                const raw = fs.readFileSync(this.logFile, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this.entries = data;
                    this.nextId = data.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
                    console.error(`📝 [ActivityLogger] Loaded ${this.entries.length} activity entries from disk`);
                }
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`⚠️ [ActivityLogger] Failed to load activity log: ${msg}`);
        }
    }
    /**
     * Persist activity log to disk as JSON.
     */
    saveToDisk() {
        try {
            const dir = path.dirname(this.logFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.logFile, JSON.stringify(this.entries, null, 2), 'utf-8');
            this.dirty = false;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`⚠️ [ActivityLogger] Failed to save activity log: ${msg}`);
        }
    }
    /**
     * Cleanup: stop timer and flush final state.
     */
    destroy() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.dirty)
            this.saveToDisk();
    }
}
export { ActivityLogger };
/** Singleton instance for project-wide use */
exports.activityLogger = new ActivityLogger();
//# sourceMappingURL=activity-logger.js.map
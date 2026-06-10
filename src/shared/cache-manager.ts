/**
 * Cache Manager — JSON-based persistent storage
 *
 * Provides a centralized cache that persists to disk as JSON.
 * Survives server restarts. Used by AI Core and browser state.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CacheEntry {
  value: unknown;
  createdAt: number;
  ttl: number | null; // null = never expires
}

export interface CacheConfig {
  /** Directory for cache files */
  cacheDir: string;
  /** Auto-save interval in ms (0 = disabled) */
  autoSaveInterval: number;
  /** Max number of entries before pruning */
  maxEntries: number;
  /** Default TTL in ms (null = never expires) */
  defaultTTL: number | null;
}

const DEFAULT_CONFIG: CacheConfig = {
  cacheDir: path.join(process.cwd(), '.cache'),
  autoSaveInterval: 30000, // 30 seconds
  maxEntries: 1000,
  defaultTTL: null,
};

export class CacheManager {
  private cache: Map<string, CacheEntry>;
  private cacheFile: string;
  private config: CacheConfig;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private dirty: boolean = false;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cacheFile = path.join(this.config.cacheDir, 'browser_state.json');
    this.cache = new Map();
    this.loadFromDisk();

    // Auto-save periodically
    if (this.config.autoSaveInterval > 0) {
      this.saveTimer = setInterval(() => {
        if (this.dirty) {
          this.saveToDisk();
        }
      }, this.config.autoSaveInterval);

      // Prevent timer from keeping Node alive
      if (this.saveTimer && typeof this.saveTimer.unref === 'function') {
        this.saveTimer.unref();
      }
    }
  }

  /**
   * Get a value from cache. Returns undefined if not found or expired.
   */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (entry.ttl !== null && Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(key);
      this.dirty = true;
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache with optional TTL.
   */
  set(key: string, value: unknown, ttl?: number | null): void {
    // Prune if at capacity
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(key)) {
      this.prune();
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl: ttl !== undefined ? ttl : this.config.defaultTTL,
    });
    this.dirty = true;
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific key from cache.
   */
  delete(key: string): boolean {
    const existed = this.cache.delete(key);
    if (existed) this.dirty = true;
    return existed;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.dirty = true;
  }

  /**
   * Get all keys in cache.
   */
  keys(): string[] {
    return [...this.cache.keys()];
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; maxEntries: number; cacheFile: string } {
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      cacheFile: this.cacheFile,
    };
  }

  /**
   * Load cache from JSON file on disk.
   */
  loadFromDisk(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, 'utf-8');
        const data: Record<string, CacheEntry> = JSON.parse(raw);

        for (const [key, entry] of Object.entries(data)) {
          // Skip expired entries while loading
          if (entry.ttl !== null && Date.now() - entry.createdAt > entry.ttl) {
            continue;
          }
          this.cache.set(key, entry);
        }

        console.error(`📦 [CacheManager] Loaded ${this.cache.size} entries from disk`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`⚠️ [CacheManager] Failed to load cache: ${msg}`);
    }
  }

  /**
   * Save cache to JSON file on disk.
   */
  saveToDisk(): void {
    try {
      const dir = path.dirname(this.cacheFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: Record<string, CacheEntry> = Object.fromEntries(this.cache);
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`⚠️ [CacheManager] Failed to save cache: ${msg}`);
    }
  }

  /**
   * Remove expired entries and oldest entries if over capacity.
   */
  private prune(): void {
    const now = Date.now();

    // Remove expired entries first
    for (const [key, entry] of this.cache) {
      if (entry.ttl !== null && now - entry.createdAt > entry.ttl) {
        this.cache.delete(key);
      }
    }

    // If still over capacity, remove oldest entries
    if (this.cache.size >= this.config.maxEntries) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = entries.slice(0, Math.floor(this.config.maxEntries * 0.2)); // Remove oldest 20%
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }

    this.dirty = true;
  }

  /**
   * Cleanup: stop timer and save final state.
   */
  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.saveToDisk();
    }
  }
}

/** Singleton instance for project-wide use */
export const cacheManager = new CacheManager();

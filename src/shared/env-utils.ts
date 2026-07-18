/**
 * Environment utility functions — shared across the entire project.
 * Kept in shared/ to avoid circular dependencies.
 */

/**
 * Determine headless mode from environment variables.
 * Priority: HEADLESS env var > CI environment detection > Linux no-display detection
 */
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

/**
 * Parse a boolean environment variable.
 * Returns undefined if the variable is not set (so callers can fall back to defaults).
 * Truthy values: "true", "1", "yes", "on"; Falsy values: "false", "0", "no", "off".
 */
export function getBoolEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  const value = raw.toLowerCase().trim();
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') {
    return true;
  }
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') {
    return false;
  }
  return undefined;
}

/**
 * Determine whether AI selector-healing should be enabled from the AI_HEALING env var.
 * Returns undefined if not set, so the caller can apply its own default (true).
 */
export function getAiHealingFromEnv(): boolean | undefined {
  return getBoolEnv('AI_HEALING');
}

/**
 * Determine whether the ad/tracker blocker should be enabled from the ENABLE_BLOCKER env var.
 * Returns undefined if not set, so the caller can apply its own default (true).
 */
export function getEnableBlockerFromEnv(): boolean | undefined {
  return getBoolEnv('ENABLE_BLOCKER');
}

/**
 * Determine whether Cloudflare Turnstile auto-solving should be enabled from the TURNSTILE env var.
 * Returns undefined if not set, so the caller can apply its own default (false).
 */
export function getTurnstileFromEnv(): boolean | undefined {
  return getBoolEnv('TURNSTILE');
}

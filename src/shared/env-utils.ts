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
 * Read a boolean-style environment variable (true/false/1/0/yes/no/on/off).
 * Returns `defaultValue` when the variable is unset or empty.
 */
export function getEnvBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const value = raw.toLowerCase().trim();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

/**
 * Decide whether Chromium needs its sandbox disabled.
 * Chromium's setuid sandbox cannot run in CI, containers, or when Node runs
 * as root, so we only disable it when required — never unconditionally, since
 * the OS-level sandbox is a strong security boundary for untrusted page
 * content.
 *
 * Priority: CHROME_NO_SANDBOX env var > federated CI detection > root detection
 */
export function shouldDisableChromiumSandbox(): boolean {
  const envNoSandbox = process.env.CHROME_NO_SANDBOX;

  if (envNoSandbox !== undefined && envNoSandbox !== null && envNoSandbox !== '') {
    const value = envNoSandbox.toLowerCase().trim();
    return value === 'true' || value === '1' || value === 'yes';
  }

  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.TRAVIS || process.env.CIRCLECI) {
    return true;
  }

  // Root (UID 0) cannot use the setuid sandbox.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return true;
  }

  return false;
}

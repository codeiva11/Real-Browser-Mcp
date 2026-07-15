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

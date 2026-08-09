/**
 * URL validation helpers — shared across all handlers that accept external URLs.
 *
 * Replay/redirect/batch tools can otherwise be abused as an SSRF primitive:
 * an agent (or prompt injection) could point the browser at internal services
 * (localhost, cloud metadata 169.254.169.254, internal RFC1918 hosts) and
 * capture their responses. Validation is opt-out by default: private-network
 * targets are blocked unless REAL_BROWSER_ALLOW_PRIVATE_NETWORK=1.
 */

const IPV4_PRIVATE =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;
const IPV4_LITERAL = /^\d+\.\d+\.\d+\.\d+$/;
const LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  '0.0.0.0',
]);

export interface UrlCheckResult {
  valid: boolean;
  url: string;
  protocol: string;
  hostname: string;
  private: boolean;
  reason?: string;
}

function hostnameIsPrivate(hostname: string): boolean {
  const target = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK_HOSTS.has(target)) return true;
  if (target.endsWith('.local') || target.endsWith('.internal')) return true;

  if (target.includes(':')) {
    // IPv6: loopback, ULA (fc/fd), link-local (fe80)
    return target === '::1' || target.startsWith('::') || target.startsWith('fe80:') || target.startsWith('fc') || target.startsWith('fd');
  }

  if (IPV6_LITERAL.test(target)) {
    // bare IPv6 literal without brackets
    return target === '::1' || target.startsWith('fe80:') || target.startsWith('fc') || target.startsWith('fd');
  }

  if (IPV4_LITERAL.test(target)) {
    return IPV4_PRIVATE.test(target);
  }

  return false;
}

// Matches bare IPv6 literals such as "::1" or "2001:db8::1" (no scheme).
const IPV6_LITERAL = /^[0-9a-f:]+$/;

function allowPrivateNetwork(): boolean {
  const v = process.env.REAL_BROWSER_ALLOW_PRIVATE_NETWORK;
  return v !== undefined && v !== null && v !== '' && ['1', 'true', 'yes'].includes(v.toLowerCase().trim());
}

/**
 * Validate and normalize an http(s) URL before the browser or server touches it.
 * Blocks non-http(s) protocols (file:, javascript:, data: …) always, and blocks
 * private/loopback addresses unless REAL_BROWSER_ALLOW_PRIVATE_NETWORK=1.
 */
export function validateHttpUrl(rawUrl: string): UrlCheckResult {
  const fail = (reason: string): UrlCheckResult => ({ valid: false, url: rawUrl, protocol: '', hostname: '', private: false, reason });

  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return fail('URL is empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail(`Unsupported protocol "${parsed.protocol}" — only http/https are allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isPrivate = hostnameIsPrivate(hostname);

  if (isPrivate && !allowPrivateNetwork()) {
    return {
      valid: false,
      url: rawUrl,
      protocol: parsed.protocol,
      hostname,
      private: true,
      reason: `Private/loopback target "${hostname}" blocked (set REAL_BROWSER_ALLOW_PRIVATE_NETWORK=1 to allow)`,
    };
  }

  return { valid: true, url: parsed.toString(), protocol: parsed.protocol, hostname, private: isPrivate };
}

/**
 * Convenience: throw an Error with a safe message when the URL is invalid.
 */
export function assertSafeUrl(rawUrl: string, toolName = 'navigate'): UrlCheckResult {
  const result = validateHttpUrl(rawUrl);
  if (!result.valid) {
    throw new Error(`${toolName}: ${result.reason || 'invalid URL'}`);
  }
  return result;
}
/**
 * URL validation helpers — shared across all handlers that accept external URLs.
 *
 * Replay/redirect/batch tools can otherwise be abused as an SSRF primitive:
 * an agent (or prompt injection) could point the browser at internal services
 * (localhost, cloud metadata 169.254.169.254, internal RFC1918 hosts) and
 * capture their responses. Validation is opt-out by default: private-network
 * targets are blocked unless REAL_BROWSER_ALLOW_PRIVATE_NETWORK=1.
 *
 * The guard covers:
 *   - non-http(s) protocols (file:, javascript:, data: …) — always blocked
 *   - string-level private/loopback hostnames (RFC1918, .local, .internal)
 *   - numeric-IP trickery: decimal (2130706433), hex (0x7f000001), short
 *     dotted (127.1) and leading-zero/octal (0177.0.0.1) forms
 *   - DNS rebinding: public-looking hostnames that RESOLVE to a private
 *     address are blocked by an async DNS check (assertSafeUrl)
 */

import * as dns from 'dns';

const IPV4_PRIVATE =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;
const IPV4_LITERAL = /^\d+\.\d+\.\d+\.\d+$/;
const LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  '0.0.0.0',
]);

// Matches bare IPv6 literals such as "::1" or "2001:db8::1" (no scheme).
const IPV6_LITERAL = /^[0-9a-f:]+$/;

// Fully numeric hostnames are IP literals in disguise (decimal or hex).
const DECIMAL_IP = /^[0-9]+$/;
const HEX_IP = /^0x[0-9a-f]+$/i;
// Dotted numeric hostnames (127.1, 127.0.0.1, 0177.0.0.1 …).
const DOTTED_NUMERIC = /^[0-9.]+$/;

export interface UrlCheckResult {
  valid: boolean;
  url: string;
  protocol: string;
  hostname: string;
  private: boolean;
  reason?: string;
}

/**
 * Expand a 1-4 part dotted numeric host into a 32-bit integer the way
 * browsers do (missing trailing parts default to 0: 127.1 → 127.0.0.1).
 */
function dottedToNumber(parts: string[]): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value = value * 256 + (parseInt(parts[i] ?? '0', 10) >>> 0);
  }
  return value >>> 0;
}

/** True when a 32-bit IPv4 value falls inside a private/loopback range. */
function isPrivateNumericValue(value: number): boolean {
  if (value >>> 24 === 10) return true; // 10.0.0.0/8
  if (value >>> 24 === 127) return true; // 127.0.0.0/8
  if (value >>> 24 === 0) return true; // 0.0.0.0/8
  if ((value >>> 16) === 0xa9fe) return true; // 169.254.0.0/16
  if ((value >>> 20) === 0xac1) return true; // 172.16.0.0/12
  if ((value >>> 16) === 0xc0a8) return true; // 192.168.0.0/16
  return false;
}

/**
 * Detect numeric-IP representations that bypass the dotted-quad private
 * regex (decimal 2130706433, hex 0x7f000001, short 127.1, octal 0177.0.0.1).
 */
function numericHostnameIsPrivate(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (DECIMAL_IP.test(h)) {
    // A leading zero makes the whole literal octal in browser URL parsing
    // (017700000001 → 127.0.0.1), so parse base 8 in that case.
    const base = h.length > 1 && h.startsWith('0') ? 8 : 10;
    const v = parseInt(h, base);
    if (Number.isFinite(v) && v <= 0xffffffff) return isPrivateNumericValue(v);
  }
  if (HEX_IP.test(h)) {
    const v = parseInt(h, 16);
    if (v <= 0xffffffff) return isPrivateNumericValue(v);
  }
  if (DOTTED_NUMERIC.test(h)) {
    const parts = h.split('.');
    if (parts.length <= 4) {
      // Leading-zero octets are ambiguous octal (0177 → 127) — never trust them.
      for (const p of parts) {
        if (p.length > 1 && p.startsWith('0')) return true;
      }
      return isPrivateNumericValue(dottedToNumber(parts));
    }
  }
  return false;
}

function hostnameIsPrivate(hostname: string): boolean {
  const target = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK_HOSTS.has(target)) return true;
  if (target.endsWith('.local') || target.endsWith('.internal')) return true;

  if (target.includes(':')) {
    // IPv6: loopback, ULA (fc/fd), link-local (fe80), and any v4-mapped form
    // (::ffff:127.0.0.1 etc.) — conservative: all "::"-prefixed are blocked.
    return target === '::1' || target.startsWith('::') || target.startsWith('fe80:') || target.startsWith('fc') || target.startsWith('fd');
  }

  if (IPV6_LITERAL.test(target)) {
    // bare IPv6 literal without brackets
    return target === '::1' || target.startsWith('fe80:') || target.startsWith('fc') || target.startsWith('fd');
  }

  if (IPV4_LITERAL.test(target)) {
    return IPV4_PRIVATE.test(target);
  }

  // Numeric trickery that the dotted-quad regex cannot see.
  if (numericHostnameIsPrivate(target)) return true;

  return false;
}

function allowPrivateNetwork(): boolean {
  const v = process.env.REAL_BROWSER_ALLOW_PRIVATE_NETWORK;
  return v !== undefined && v !== null && v !== '' && ['1', 'true', 'yes'].includes(v.toLowerCase().trim());
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('::') || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return isPrivateNumericValue(dottedToNumber(ip.split('.')));
}

const DNS_CHECK_TIMEOUT_MS = 2000;

/**
 * Resolve the hostname and report whether it maps to any private address.
 * DNS failures/timeouts are NOT treated as private — an unresolvable name
 * will fail navigation on its own, and we never want to block a legit site
 * because its resolver hiccuped.
 */
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  try {
    const addresses = await Promise.race([
      dns.promises.lookup(hostname, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('dns-check timeout')), DNS_CHECK_TIMEOUT_MS)
      ),
    ]);
    return addresses.some((a) => isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * Validate and normalize an http(s) URL before the browser or server touches it.
 * Blocks non-http(s) protocols (file:, javascript:, data: …) always, and blocks
 * private/loopback addresses (including numeric/octal/hex IP trickery) unless
 * REAL_BROWSER_ALLOW_PRIVATE_NETWORK=1.
 *
 * NOTE: this is a synchronous structural check. Use the async assertSafeUrl()
 * below when you also want the DNS-rebinding check.
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
 * Async because it ALSO performs a DNS check to close the rebinding hole:
 * a public-looking hostname that resolves to a private address is rejected.
 */
export async function assertSafeUrl(rawUrl: string, toolName = 'navigate'): Promise<UrlCheckResult> {
  const result = validateHttpUrl(rawUrl);
  if (!result.valid) {
    throw new Error(`${toolName}: ${result.reason || 'invalid URL'}`);
  }
  if (!allowPrivateNetwork() && !result.private) {
    const rebinds = await resolvesToPrivate(result.hostname);
    if (rebinds) {
      throw new Error(`${toolName}: hostname "${result.hostname}" resolves to a private address (blocked)`);
    }
  }
  return result;
}

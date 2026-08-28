/**
 * The check that keeps §9 invariant 3 honest.
 *
 * The invariant permits an LLM adapter or embedding provider to open a socket
 * to its configured model host, and nothing else. That permission is only
 * meaningful if the host is actually on-premise, so this refuses anything that
 * is not a loopback or private address — at load, not at request time.
 *
 * Failing here rather than at the first inference is deliberate: a deployment
 * must not be able to route MRPL's classified corpus to a hosted API by
 * editing one config line and having it work.
 * @module @mrpl/dsh-workbench-ollama/host-guard
 */

/** RFC 1918 and loopback ranges, plus the mDNS suffix a LAN host may use. */
const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  // 172.16.0.0 – 172.31.255.255
  /^172\.(1[6-9]|2\d|3[01])\./,
]

/**
 * Whether a hostname denotes an on-premise machine.
 * @param hostname - the URL hostname, without port.
 * @returns true when the host is loopback, private, or an explicit .local name.
 */
export function isOnPremiseHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  // IPv6 unique-local (fc00::/7) covers fc.. and fd.. prefixes.
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
  return PRIVATE_V4.some((range) => range.test(host))
}

/**
 * Validate a configured model-host URL.
 * @param baseUrl - the configured endpoint.
 * @returns the parsed URL, for the caller to build request paths from.
 * @throws when the URL is malformed, or its host is not on-premise — the
 *   deployment is misconfigured and must not start.
 */
export function requireOnPremiseUrl(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`wb-ollama: "${baseUrl}" is not a valid URL`)
  }
  if (!isOnPremiseHost(url.hostname)) {
    throw new Error(
      `wb-ollama: refusing to use model host "${url.hostname}" — it is not a loopback or ` +
        'private address. §9 invariant 3 permits on-premise model traffic only; a public ' +
        'host would send classified material off the premises.',
    )
  }
  return url
}

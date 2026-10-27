// Sites the user chose to translate automatically. Each one is a site key (see siteKey) and
// the browser holds the matching optional host permission.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The site an address belongs to: its host without a leading "www.", or null for pages this
 *  extension does not ask site access for (not http(s), or an IPv6 address). */
export function siteKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host || host.includes(':')) return null;
  return host;
}

/** Host permission patterns for a site and its subdomains ("*." also matches the bare host). */
export function sitePatterns(key: string): string[] {
  const host = IPV4.test(key) ? key : `*.${key}`;
  return [`http://${host}/*`, `https://${host}/*`];
}

/** The chosen site that covers this address, if any. */
export function matchSite(sites: readonly string[], url: string): string | null {
  const key = siteKey(url);
  if (!key) return null;
  return sites.find((site) => key === site || (!IPV4.test(site) && key.endsWith(`.${site}`))) ?? null;
}

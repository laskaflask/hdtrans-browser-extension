// Sites the user chose to translate automatically. Each one is a site key (see siteKey) and
// the browser holds the matching optional host permission. Cross-origin frames are allowed one
// origin at a time, as an optional host permission pattern (see originPattern).

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Optional host permission patterns covering every http(s) frame. Only kept so a broad grant
 *  made by an older version can be recognized; translation never asks for it. */
export const ALL_ORIGINS = ['http://*/*', 'https://*/*'];

/** The http(s) origin of an address, or null for anything the extension cannot ask access for. */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** The optional host permission pattern for one frame origin ("https://embed.example.jp/*").
 *  Browsers' match patterns do not take a port, so a host pattern covers every port of it. */
export function originPattern(origin: string): string | null {
  const parsed = originOf(origin);
  if (!parsed) return null;
  const { protocol, hostname } = new URL(parsed);
  return hostname && !hostname.includes(':') ? `${protocol}//${hostname}/*` : null;
}

/** A frame address without its fragment, so the same frame matches before and after loading. */
export function frameKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

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

/** The chosen sites that cover this address: the site itself and any parent site chosen too. */
export function matchSites(sites: readonly string[], url: string): string[] {
  const key = siteKey(url);
  if (!key) return [];
  return sites.filter((site) => key === site || (!IPV4.test(site) && key.endsWith(`.${site}`)));
}

/** The first chosen site that covers this address, if any. */
export function matchSite(sites: readonly string[], url: string): string | null {
  return matchSites(sites, url)[0] ?? null;
}

/** Whether these granted origins are exactly the site's patterns, not a broader grant that
 *  happens to cover it (such as access to all sites given in the browser's settings). */
export function grantedFor(site: string, origins: readonly string[]): boolean {
  return sitePatterns(site).every((pattern) => origins.includes(pattern));
}

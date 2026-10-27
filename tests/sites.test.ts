import { describe, expect, it } from 'vitest';
import { matchSite, siteKey, sitePatterns } from '../lib/sites';

describe('siteKey', () => {
  it('is the host without www, in lower case', () => {
    expect(siteKey('https://www.Example.co.jp/a?b#c')).toBe('example.co.jp');
    expect(siteKey('http://blog.example.co.jp:8080/')).toBe('blog.example.co.jp');
  });

  it('is null for pages that get no site access', () => {
    expect(siteKey('chrome://extensions')).toBeNull();
    expect(siteKey('file:///tmp/a.html')).toBeNull();
    expect(siteKey('http://[::1]/')).toBeNull();
    expect(siteKey('')).toBeNull();
    expect(siteKey(undefined as unknown as string)).toBeNull();
  });
});

describe('sitePatterns', () => {
  it('covers the site and its subdomains over http and https', () => {
    expect(sitePatterns('example.co.jp')).toEqual(['http://*.example.co.jp/*', 'https://*.example.co.jp/*']);
  });

  it('covers an IPv4 address only as it is', () => {
    expect(sitePatterns('192.168.0.1')).toEqual(['http://192.168.0.1/*', 'https://192.168.0.1/*']);
  });
});

describe('matchSite', () => {
  const sites = ['example.co.jp', 'blog.example.com'];

  it('matches the site, www and subdomains', () => {
    expect(matchSite(sites, 'https://example.co.jp/')).toBe('example.co.jp');
    expect(matchSite(sites, 'https://www.example.co.jp/x')).toBe('example.co.jp');
    expect(matchSite(sites, 'https://news.example.co.jp/')).toBe('example.co.jp');
  });

  it('does not match a parent, a sibling or a look-alike', () => {
    expect(matchSite(sites, 'https://example.com/')).toBeNull();
    expect(matchSite(sites, 'https://other.example.com/')).toBeNull();
    expect(matchSite(sites, 'https://notexample.co.jp/')).toBeNull();
    expect(matchSite(sites, 'https://example.co.jp.evil.test/')).toBeNull();
  });

  it('matches nothing for pages without a site', () => {
    expect(matchSite(sites, 'about:blank')).toBeNull();
  });
});

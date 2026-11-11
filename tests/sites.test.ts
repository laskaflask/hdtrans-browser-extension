import { describe, expect, it } from 'vitest';
import {
  frameKey,
  grantedFor,
  matchSite,
  matchSites,
  originOf,
  originPattern,
  siteKey,
  sitePatterns,
} from '../lib/sites';

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

describe('matchSites', () => {
  it('lists the site and every chosen parent site', () => {
    const sites = ['example.com', 'blog.example.com', 'other.com'];
    expect(matchSites(sites, 'https://blog.example.com/')).toEqual(['example.com', 'blog.example.com']);
    expect(matchSites(sites, 'https://example.com/')).toEqual(['example.com']);
  });
});

describe('grantedFor', () => {
  it('is true only for exactly the site patterns', () => {
    expect(grantedFor('example.com', ['http://*.example.com/*', 'https://*.example.com/*'])).toBe(true);
    expect(grantedFor('example.com', ['https://*.example.com/*'])).toBe(false);
    expect(grantedFor('example.com', ['http://*/*', 'https://*/*'])).toBe(false);
  });
});

describe('originOf / originPattern', () => {
  it('is the origin of an http(s) address', () => {
    expect(originOf('https://Platform.Twitter.com:443/embed?x=1')).toBe('https://platform.twitter.com');
    expect(originOf('http://localhost:8080/frame')).toBe('http://localhost:8080');
  });

  it('is null for what the extension cannot ask access for', () => {
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('data:text/html,hi')).toBeNull();
    expect(originOf('file:///tmp/a.html')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('makes a host permission pattern for one origin only', () => {
    expect(originPattern('https://embed.example.jp')).toBe('https://embed.example.jp/*');
    // Match patterns have no port; the host pattern covers every port of the host.
    expect(originPattern('http://localhost:8080')).toBe('http://localhost/*');
    expect(originPattern('about:blank')).toBeNull();
  });
});

describe('frameKey', () => {
  it('drops the fragment so a frame matches before and after loading', () => {
    expect(frameKey('https://embed.example.jp/a?x=1#top')).toBe('https://embed.example.jp/a?x=1');
    expect(frameKey('not a url')).toBe('not a url');
  });
});

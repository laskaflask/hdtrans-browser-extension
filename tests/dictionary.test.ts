import { describe, expect, it } from 'vitest';
import { matchingRules, newRule, parseTsv, ruleMatches, rulesToTsv, validatePattern } from '../lib/dictionary';

describe('ruleMatches', () => {
  it('matches a host and its subdomains only', () => {
    const rule = { matchType: 'host' as const, pattern: 'syosetu.com' };
    expect(ruleMatches(rule, 'https://ncode.syosetu.com/n1/')).toBe(true);
    expect(ruleMatches(rule, 'https://syosetu.com/')).toBe(true);
    expect(ruleMatches(rule, 'https://notsyosetu.com/')).toBe(false);
  });

  it('matches prefix, glob and regex patterns', () => {
    expect(ruleMatches({ matchType: 'prefix', pattern: 'https://a.jp/works/1/' }, 'https://a.jp/works/1/ep/2')).toBe(true);
    expect(ruleMatches({ matchType: 'prefix', pattern: 'https://a.jp/works/1/' }, 'https://a.jp/works/12/')).toBe(false);
    const glob = { matchType: 'glob' as const, pattern: 'https://kakuyomu.jp/works/*/episodes/*' };
    expect(ruleMatches(glob, 'https://kakuyomu.jp/works/123/episodes/456')).toBe(true);
    expect(ruleMatches(glob, 'https://kakuyomu.jp/works/123')).toBe(false);
    expect(ruleMatches({ matchType: 'regex', pattern: '^https://x\\.jp/(news|blog)/' }, 'https://x.jp/blog/1')).toBe(true);
  });

  it('never matches an invalid pattern', () => {
    expect(validatePattern('regex', '(')).not.toBe('');
    expect(ruleMatches({ matchType: 'regex', pattern: '(' }, 'https://x.jp/')).toBe(false);
    expect(ruleMatches({ matchType: 'host', pattern: '' }, 'https://x.jp/')).toBe(false);
  });
});

describe('matchingRules', () => {
  it('puts global rules first so site rules override them, and skips disabled rules', () => {
    const site = newRule({ name: 'site', matchType: 'host', pattern: 'x.jp' });
    const global = newRule({ name: 'global', matchType: 'all' });
    const off = newRule({ name: 'off', matchType: 'all', enabled: false });
    expect(matchingRules([site, off, global], 'https://x.jp/').map((r) => r.name)).toEqual(['global', 'site']);
  });
});

describe('TSV', () => {
  it('round-trips entries and drops tabs inside fields', () => {
    const rule = newRule({
      name: 'n',
      entries: [{ ja: '魔導具', ko: '마도구' }, { ja: 'ユキ', ko: '유키', pos: 'name' }, { ja: 'さん', ko: '', pos: 'hon', options: 'prio=2' }, { ja: '', ko: 'x' }],
    });
    const tsv = rulesToTsv([rule]);
    expect(tsv).toBe('# n\n魔導具\t마도구\nユキ\t유키\tname\nさん\t\thon\tprio=2\n');
    expect(parseTsv(tsv)).toEqual(rule.entries.slice(0, 3));
    expect(rulesToTsv([newRule({ entries: [{ ja: 'a\tb', ko: 'c\nd' }] })])).toContain('a b\tc d');
  });
});

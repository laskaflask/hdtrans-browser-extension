// Custom dictionaries scoped to sites or URL patterns, and how they combine into one
// hdTrans user dictionary (TSV) for a given page.

export type MatchType = 'all' | 'host' | 'prefix' | 'glob' | 'regex';

export interface DictEntry {
  ja: string;
  ko: string;
  /** hdTrans user dictionary part of speech (n, name, surname, v5, ...). Empty means n. */
  pos?: string;
  /** Native TSV options, for example "prio=2 force". */
  options?: string;
}

export interface DictRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: MatchType;
  /** Host (example.com), URL prefix, URL glob with * or a regular expression. Ignored for 'all'. */
  pattern: string;
  entries: DictEntry[];
}

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  all: '모든 사이트',
  host: '사이트(도메인)',
  prefix: '주소 시작',
  glob: '주소 패턴(*)',
  regex: '정규식',
};

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`);
}

/** Returns an error message, or '' when the pattern is usable. */
export function validatePattern(matchType: MatchType, pattern: string): string {
  const value = pattern.trim();
  if (matchType === 'all') return '';
  if (!value) return '패턴을 입력하세요.';
  if (matchType === 'regex') {
    try {
      new RegExp(value);
    } catch (error) {
      return `정규식 오류: ${(error as Error).message}`;
    }
  }
  if (matchType === 'host' && /[/:\s]/.test(value)) return '도메인만 입력하세요. 예: example.com';
  return '';
}

export function ruleMatches(rule: Pick<DictRule, 'matchType' | 'pattern'>, url: string): boolean {
  const pattern = rule.pattern.trim();
  if (rule.matchType === 'all') return true;
  if (!pattern || validatePattern(rule.matchType, pattern)) return false;
  switch (rule.matchType) {
    case 'host': {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return false;
      }
      const want = pattern.toLowerCase().replace(/^\*\./, '');
      return host === want || host.endsWith(`.${want}`);
    }
    case 'prefix':
      return url.startsWith(pattern);
    case 'glob':
      return globToRegExp(pattern).test(url);
    case 'regex':
      return new RegExp(pattern).test(url);
  }
}

/** Rules for a page in application order: 'all' rules first, then the rest in list order.
 *  hdTrans lets a later row with the same key and part of speech replace an earlier one,
 *  so site rules override the global dictionary. */
export function matchingRules(rules: readonly DictRule[], url: string): DictRule[] {
  const enabled = rules.filter((rule) => rule.enabled && ruleMatches(rule, url));
  return [...enabled.filter((r) => r.matchType === 'all'), ...enabled.filter((r) => r.matchType !== 'all')];
}

function clean(field: string | undefined): string {
  return (field ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export function entryToTsv(entry: DictEntry): string {
  const fields = [clean(entry.ja), clean(entry.ko)];
  const pos = clean(entry.pos);
  const options = clean(entry.options);
  if (pos || options) fields.push(pos);
  if (options) fields.push(options);
  return fields.join('\t');
}

export function rulesToTsv(rules: readonly DictRule[]): string {
  const lines: string[] = [];
  for (const rule of rules) {
    const rows = rule.entries.filter((e) => clean(e.ja));
    if (!rows.length) continue;
    lines.push(`# ${clean(rule.name) || rule.id}`);
    for (const entry of rows) lines.push(entryToTsv(entry));
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** Parses pasted TSV (ja, ko, pos, options). Comment and blank lines are skipped. */
export function parseTsv(text: string): DictEntry[] {
  const entries: DictEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const [ja = '', ko = '', pos = '', options = ''] = raw.split('\t').map((f) => f.trim());
    if (!ja) continue;
    entries.push({ ja, ko, ...(pos && { pos }), ...(options && { options }) });
  }
  return entries;
}

export function newRule(partial: Partial<DictRule> = {}): DictRule {
  return {
    id: crypto.randomUUID(),
    name: '새 사전',
    enabled: true,
    matchType: 'host',
    pattern: '',
    entries: [],
    ...partial,
  };
}

import { describe, expect, it } from 'vitest';
import { hasJapanese, joinPieces, splitPieces } from '../lib/text';

describe('text pieces', () => {
  it('keeps whitespace and non-Japanese lines around translated cores', () => {
    const pieces = splitPieces('  ログイン \nHello\n\tメニュー');
    expect(pieces.map((p) => p.translate)).toEqual([true, false, true]);
    const out = pieces.map((p) => (p.translate ? { ...p, core: `<${p.core}>` } : p));
    expect(joinPieces(out)).toBe('  <ログイン> \nHello\n\t<メニュー>');
  });

  it('detects kana and kanji, not Latin or Hangul', () => {
    expect(hasJapanese('ｶﾀｶﾅ')).toBe(true);
    expect(hasJapanese('東京')).toBe(true);
    expect(hasJapanese('한국어 abc')).toBe(false);
  });
});

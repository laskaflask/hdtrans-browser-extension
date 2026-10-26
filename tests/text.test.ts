import { describe, expect, it } from 'vitest';
import { hasJapanese, joinPieces, planBoth, planInline, planLines, splitPieces } from '../lib/text';

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

describe('planBoth', () => {
  it('sends a sentence and its ruby readings together and splits the output back', () => {
    const plan = planBoth(planInline(['――〈', '摘命者', '〉。']), planLines(['グリムリーパー']));
    expect(plan.lines).toEqual(['――〈‖摘命者‖〉。', '――〈摘命者〉。', 'グリムリーパー']);
    expect(plan.apply(['――〈∥적명자∥〉.', '――〈적명자〉.', '그림 리퍼'])).toEqual(['――〈', '적명자', '〉.', '그림 리퍼']);
  });

  it('cannot be applied when the first plan cannot', () => {
    const plan = planBoth(planInline(['今日は', '晴れ']), planLines(['はれ']));
    expect(plan.apply(['오늘은', '오늘은 맑음', '하레'])).toBeUndefined();
  });
});

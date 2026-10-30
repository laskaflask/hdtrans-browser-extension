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
    expect(plan.lines).toEqual(['――〈∥摘命者∥〉。', '――〈摘命者〉。', 'グリムリーパー']);
    expect(plan.apply(['――〈∥적명자∥〉.', '――〈적명자〉.', '그림 리퍼'])).toEqual(['――〈', '적명자', '〉.', '그림 리퍼']);
  });

  it('sends a word with one node per letter as one part, written to its first node', () => {
    const plan = planInline(['彼は', '本', '当', 'に', '来た。', '雨', ' ', '雪']);
    expect(plan.lines).toEqual(['彼は∥本当に∥来た。∥雨∥雪', '彼は本当に来た。雨雪']);
    expect(plan.apply(['그는∥정말로∥왔다.∥비∥눈', '그는 정말로 왔다. 비 눈'])).toEqual(['그는 ', '정말로 ', '', '', '왔다. ', '비', ' ', '눈']);
  });

  it('finds the boundary that splits a word and sends the sentence again without it', () => {
    const plan = planBoth(planInline(['今日は', '弄', 'ぶ。'], [false, true, false]), planLines(['もてあそ']));
    const first = ['오늘은∥농∥.', '오늘은 희롱한다.', '가질 수 있는'];
    expect(plan.apply(first)).toBeUndefined();
    // Each suspect boundary alone: 今日は|弄 keeps the translation, 弄|ぶ does not.
    const probe = plan.retry!(first)!;
    expect(probe.lines).toEqual(['今日は∥弄ぶ。', '今日は弄∥ぶ。']);
    const second = ['오늘은∥희롱한다.', '오늘은 농∥.'];
    expect(probe.apply(second)).toBeUndefined();
    const joined = probe.retry!(second)!;
    expect(joined.lines).toEqual(['今日は∥弄ぶ。', '今日は弄ぶ。']);
    expect(joined.apply(['오늘은∥희롱한다.', '오늘은 희롱한다.'])).toEqual(['오늘은 ', '희롱한다.', '', '가질 수 있는']);
  });

  it('keeps the marked output when no boundary alone changes the translation', () => {
    const plan = planInline(['今日は', '晴れ', 'です'], [false, true, false]);
    const first = ['오늘은∥맑음∥이다', '오늘은 맑습니다'];
    expect(plan.apply(first)).toBeUndefined();
    const probe = plan.retry!(first)!;
    expect(probe.lines).toEqual(['今日は∥晴れです', '今日は晴れ∥です']);
    expect(probe.apply(['오늘은∥맑습니다', '오늘은 맑∥습니다'])).toEqual(['오늘은', '맑음', '이다']);
  });

  it('looks into boundaries at ruby bases only', () => {
    const plan = planInline(['これは', '大事', 'なことだ。']);
    expect(plan.apply(['이것은∥중요∥한 일이다.', '이것은 소중한 일이다.'])).toEqual(['이것은', '중요', '한 일이다.']);
  });

  it('joins a two-part sentence at once when its boundary changes the translation', () => {
    const plan = planInline(['弄', 'ぶ。'], [true, false]);
    const joined = plan.retry!(['농∥.', '희롱한다.'])!;
    expect(joined.lines).toEqual(['弄ぶ。']);
    expect(joined.apply(['희롱한다.'])).toEqual(['희롱한다.', '']);
  });

  it('cannot be applied when the first plan cannot', () => {
    const plan = planBoth(planInline(['今日は', '晴れ']), planLines(['はれ']));
    expect(plan.apply(['오늘은', '오늘은 맑음', '하레'])).toBeUndefined();
  });
});

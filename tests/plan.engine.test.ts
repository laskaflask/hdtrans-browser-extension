// Runs plans through the real engine from the hdtrans package.
import { HdTrans } from 'hdtrans';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planInline, planLines } from '../lib/text';

let t: HdTrans;
beforeAll(async () => {
  t = await HdTrans.init();
});
afterAll(() => t.close());

function run(plan: ReturnType<typeof planInline>): string[] | undefined {
  t.reset();
  const out = plan.lines.length ? t.translate(plan.lines.join('\n')).split('\n') : [];
  return plan.apply(out);
}

describe('planInline with the engine', () => {
  it('translates a sentence split by inline elements as one, keeping its spacing', () => {
    expect(run(planInline(['ユキさんは', '魔導具', 'を使った。']))).toEqual(['유키 씨는 ', '마도구', '를 썼다.']);
    expect(run(planInline(['詳しくは', 'こちら', 'をご覧ください。']))).toEqual(['자세하게는 ', '이쪽', '을 봐 주세요.']);
  });

  it('keeps whitespace-only and surrounding whitespace of nodes', () => {
    expect(run(planInline(['\n  今日は', ' ', 'いい天気ですね。\n']))).toEqual(['\n  오늘은', ' ', '좋은 날씨군요.\n']);
  });

  it('translates preformatted text line by line', () => {
    expect(run(planLines(['一行目\n  二行目']))).toEqual(['1행째\n  2행째']);
  });
});

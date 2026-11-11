import { describe, expect, it } from 'vitest';
import { menuTitle, menuTitleFor } from '../lib/menu';

describe('menuTitle', () => {
  it('offers translation for an original page and restore otherwise', () => {
    expect(menuTitle('original')).toBe('hdTrans로 번역하기');
    expect(menuTitle('translating')).toBe('hdTrans 원문으로 되돌리기');
    expect(menuTitle('translated')).toBe('hdTrans 원문으로 되돌리기');
  });
});

describe('menuTitleFor', () => {
  it('adds the missing embed count to the one menu item', () => {
    expect(menuTitleFor('original', 0)).toBe('hdTrans로 번역하기');
    expect(menuTitleFor('translated', 0)).toBe('hdTrans 원문으로 되돌리기');
    expect(menuTitleFor('translated', 2)).toBe('hdTrans 원문으로 되돌리기 · 임베드 2개 권한 필요');
  });
});

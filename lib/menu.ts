// The right-click menu: one item that translates or restores the page. When part of the page
// could not be translated for lack of frame access, its title says so; a second item (and the
// submenu the browser would put the two in) is avoided on purpose.
import type { PageState } from './messages';

export const MENU_TOGGLE = 'hdtrans-toggle-page';

export function menuTitle(state: PageState): string {
  return state === 'original' ? 'hdTrans로 번역하기' : 'hdTrans 원문으로 되돌리기';
}

/** The menu item's title, with the reason part of the page stayed in Japanese. */
export function menuTitleFor(state: PageState, missing: number): string {
  const title = menuTitle(state);
  return missing > 0 ? `${title} · 임베드 ${missing}개 권한 필요` : title;
}

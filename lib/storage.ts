import { storage } from '#imports';
import type { DictRule } from './dictionary';

export type Speech = 'strict' | 'soft';

export interface Settings {
  /** The speech level of text inside 「」. */
  speech: Speech;
  /** Also translate title, alt, placeholder and aria-label attributes. */
  translateAttributes: boolean;
  /** Keep translating content added after the page was translated. */
  observeMutations: boolean;
  /** Make text that is waiting to be translated pulse until it is. */
  showProgress: boolean;
  /** Keep the original text and show the translation after it. */
  bilingual: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speech: 'strict',
  translateAttributes: true,
  observeMutations: true,
  showProgress: true,
  bilingual: false,
};

// storage.local: dictionaries can outgrow storage.sync's per-item quota.
export const dictRulesItem = storage.defineItem<DictRule[]>('local:dictRules', { fallback: [] });

/** Sites translated automatically (site keys, see lib/sites.ts). Only counts while the browser
 *  still holds the site's host permission; the user can take it back in the browser. */
export const autoSitesItem = storage.defineItem<string[]>('local:autoSites', { fallback: [] });

export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

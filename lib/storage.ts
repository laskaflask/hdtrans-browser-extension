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
}

export const DEFAULT_SETTINGS: Settings = {
  speech: 'strict',
  translateAttributes: true,
  observeMutations: true,
};

// storage.local: dictionaries can outgrow storage.sync's per-item quota.
export const dictRulesItem = storage.defineItem<DictRule[]>('local:dictRules', { fallback: [] });

export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

import { matchingRules, rulesToTsv, type DictRule } from '@/lib/dictionary';
import { extensionFiles, lazyEngine } from '@/lib/engine';
import type {
  BackgroundRequest,
  ContentRequest,
  ContentStatus,
  EngineRequest,
  EngineResponse,
  PageState,
  TranslateBatchResponse,
  UiRequest,
} from '@/lib/messages';
import { grantedFor, matchSite, sitePatterns } from '@/lib/sites';
import { autoSitesItem, dictRulesItem, getSettings, pendingSitesItem, updateSites } from '@/lib/storage';

const MENU_TOGGLE = 'hdtrans-toggle-page';
const OFFSCREEN_PATH = '/offscreen.html';

export default defineBackground(() => {
  // Firefox for Android has no context menus or keyboard shortcuts; the popup still works.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus?.removeAll(() => {
      browser.contextMenus.create({ id: MENU_TOGGLE, title: menuTitle('original'), contexts: ['page', 'selection', 'link', 'image'] });
    });
  });

  // One item that translates an untranslated page and restores a translated (or translating) one,
  // which is what the page itself does with toggle-page.
  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_TOGGLE || !tab?.id) return;
    void sendToPage(tab.id, { type: 'toggle-page' });
  });

  // The menu is shared by every tab, so its title follows the active tab of the focused window.
  browser.tabs.onActivated.addListener(() => void refreshMenu());
  browser.windows?.onFocusChanged.addListener(() => void refreshMenu());

  browser.commands?.onCommand.addListener((command, tab) => {
    if (command === 'toggle-translation' && tab?.id) void sendToPage(tab.id, { type: 'toggle-page' });
  });

  browser.runtime.onMessage.addListener((msg: BackgroundRequest | UiRequest, sender, sendResponse) => {
    switch (msg?.type) {
      case 'translate-batch': {
        const url = sender.tab?.url ?? sender.url ?? '';
        translateBatch(url, msg.lines).then(sendResponse);
        return true;
      }
      case 'page-state':
        if (sender.tab?.id && sender.frameId === 0) {
          setBadge(sender.tab.id, msg.state);
          if (sender.tab.active) void refreshMenu();
        }
        return;
      case 'ui-translate-tab':
        sendToPage(msg.tabId, { type: msg.action }).then(sendResponse);
        return true;
      case 'ui-check-userdict':
        callEngine({ type: 'check-userdict', userDict: msg.userDict }).then(sendResponse);
        return true;
      case 'ui-engine-info':
        callEngine({ type: 'info' }).then(sendResponse);
        return true;
    }
  });

  // A navigation drops the page's translation, so drop its badge too. pushState, #hash and a page
  // back from the back/forward cache load too but keep theirs, so once loaded the page says which
  // it is. The address is only there for sites the extension has a host permission for, which are
  // the automatic ones.
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === 'loading') {
      setBadge(tabId, 'original');
      if (tab.active) void refreshMenu();
      try {
        browser.pageAction?.show?.(tabId);
      } catch {}
    } else if (change.status === 'complete') {
      // Translating only after the page has answered, so the answer cannot undo the translation's badge.
      void syncTab(tabId, tab.active).then((state) => {
        if (state === 'original' && tab.url) void translateAutomatically(tabId, tab.url);
      });
    }
  });

  // The permission prompt can close the popup before it hears the answer.
  browser.permissions.onAdded.addListener(({ origins = [] }) => void savePendingSites(origins));
  // A site whose permission the user took back in the browser is no longer chosen, so a later
  // grant of broader access does not bring it back.
  browser.permissions.onRemoved.addListener(() => void dropRevokedSites());

  dictRulesItem.watch((rules) => {
    cachedRules = rules;
  });
});

let cachedRules: DictRule[] | undefined;

async function userDictFor(url: string): Promise<string> {
  cachedRules ??= await dictRulesItem.getValue();
  return rulesToTsv(matchingRules(cachedRules, url));
}

async function translateBatch(url: string, lines: string[]): Promise<TranslateBatchResponse> {
  const [userDict, settings] = await Promise.all([userDictFor(url), getSettings()]);
  return callEngine({ type: 'translate', lines, userDict, speech: settings.speech });
}

// Firefox's background page has a DOM and runs the engine itself; Chrome's service worker
// cannot, so there the engine lives in an offscreen document.
const localEngine = import.meta.env.FIREFOX ? lazyEngine(extensionFiles) : undefined;

async function callEngine(msg: EngineRequest): Promise<EngineResponse> {
  if (localEngine) return localEngine(msg);
  try {
    await ensureOffscreen();
    const response: EngineResponse | undefined = await browser.runtime.sendMessage({ ...msg, target: 'offscreen' });
    return response ?? { error: '번역 엔진이 응답하지 않았습니다.' };
  } catch (error) {
    return { error: String(error) };
  }
}

let creatingOffscreen: Promise<void> | undefined;

async function ensureOffscreen(): Promise<void> {
  const url = browser.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length) return;
  creatingOffscreen ??= browser.offscreen
    .createDocument({
      url,
      reasons: [browser.offscreen.Reason.WORKERS],
      justification: 'Runs the hdTrans WebAssembly translation engine and keeps its dictionary loaded.',
    })
    .finally(() => {
      creatingOffscreen = undefined;
    });
  await creatingOffscreen;
}

/** Translates a loaded page of a site the user chose to translate automatically. */
async function translateAutomatically(tabId: number, url: string): Promise<void> {
  const sites = await autoSitesItem.getValue();
  const site = matchSite(sites, url);
  if (!site) return;
  // The user may have taken the permission back in the browser; then the choice no longer counts.
  if (!(await browser.permissions.contains({ origins: sitePatterns(site) }))) return;
  await sendToPage(tabId, { type: 'translate-page' });
}

/** Saves the pending sites these origins were granted for. */
async function savePendingSites(origins: string[]): Promise<void> {
  const granted = (await pendingSitesItem.getValue()).filter((site) => grantedFor(site, origins));
  if (!granted.length) return;
  await updateSites(autoSitesItem, (sites) => [...sites, ...granted]);
  await updateSites(pendingSitesItem, (sites) => sites.filter((s) => !granted.includes(s)));
}

async function dropRevokedSites(): Promise<void> {
  const sites = await autoSitesItem.getValue();
  const kept: string[] = [];
  for (const site of sites) {
    if (await browser.permissions.contains({ origins: sitePatterns(site) })) kept.push(site);
  }
  if (kept.length !== sites.length) await autoSitesItem.setValue(kept);
}

/** Injects the page script on first use (activeTab grants access after a menu or popup click). */
async function sendToPage(tabId: number, msg: ContentRequest): Promise<ContentStatus> {
  try {
    return await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    // Not injected yet.
  }
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/translator.js'] });
    return await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (error) {
    return { state: 'original', done: 0, total: 0, error: `이 페이지에서는 번역할 수 없습니다. (${String(error)})` };
  }
}

function menuTitle(state: PageState): string {
  return state === 'original' ? 'hdTrans로 번역하기' : 'hdTrans 원문으로 되돌리기';
}

/** The state of a tab's page. Only asks a page script that is already there; a page without one is untranslated. */
async function pageState(tabId: number): Promise<PageState> {
  try {
    const status: ContentStatus | undefined = await browser.tabs.sendMessage(tabId, { type: 'get-state' }, { frameId: 0 });
    return status?.state ?? 'original';
  } catch {
    return 'original';
  }
}

/** Sets a loaded tab's badge, and the menu if the tab is active, from the state of its page. */
async function syncTab(tabId: number, active: boolean): Promise<PageState> {
  const state = await pageState(tabId);
  setBadge(tabId, state);
  if (active) void refreshMenu();
  return state;
}

let menuRefresh = 0;

/** Sets the menu title from the state of the focused window's active tab. */
async function refreshMenu(): Promise<void> {
  if (!browser.contextMenus) return;
  const refresh = ++menuRefresh;
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const state = tab?.id ? await pageState(tab.id) : 'original';
  // A later refresh has already answered for a newer tab or state.
  if (refresh !== menuRefresh) return;
  browser.contextMenus.update(MENU_TOGGLE, { title: menuTitle(state) }).catch(() => {});
}

function setBadge(tabId: number, state: ContentStatus['state']): void {
  const text = state === 'translated' ? 'KO' : state === 'translating' ? '…' : '';
  if (browser.action?.setBadgeText) {
    browser.action.setBadgeText({ tabId, text }).catch(() => {});
    browser.action.setBadgeBackgroundColor({ tabId, color: '#2f6fed' }).catch(() => {});
  }
  if (browser.pageAction?.setTitle) {
    const title = state === 'translated' ? 'hdTrans (번역됨)' : state === 'translating' ? 'hdTrans (번역 중…)' : 'hdTrans';
    try {
      browser.pageAction.setTitle({ tabId, title });
    } catch {}
  }
}

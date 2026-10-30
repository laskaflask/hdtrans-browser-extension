import { matchingRules, rulesToTsv, type DictRule } from '@/lib/dictionary';
import { extensionFiles, lazyEngine } from '@/lib/engine';
import type {
  BackgroundRequest,
  ContentRequest,
  ContentStatus,
  EngineRequest,
  EngineResponse,
  TranslateBatchResponse,
  UiRequest,
} from '@/lib/messages';
import { grantedFor, matchSite, sitePatterns } from '@/lib/sites';
import { autoSitesItem, dictRulesItem, getSettings, pendingSitesItem, updateSites } from '@/lib/storage';

const MENU_TRANSLATE = 'hdtrans-translate-page';
const MENU_RESTORE = 'hdtrans-restore-page';
const OFFSCREEN_PATH = '/offscreen.html';

export default defineBackground(() => {
  // Firefox for Android has no context menus or keyboard shortcuts; the popup still works.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus?.removeAll(() => {
      browser.contextMenus.create({ id: MENU_TRANSLATE, title: '페이지 전체 번역', contexts: ['page', 'selection', 'link', 'image'] });
      browser.contextMenus.create({ id: MENU_RESTORE, title: '원래대로 복원', contexts: ['page', 'selection', 'link', 'image'] });
    });
  });

  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const action = info.menuItemId === MENU_RESTORE ? 'restore-page' : 'translate-page';
    void sendToPage(tab.id, { type: action });
  });

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
        if (sender.tab?.id && sender.frameId === 0) setBadge(sender.tab.id, msg.state);
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

  // A navigation drops the page's translation, so drop its badge too. The address is only
  // there for sites the extension has a host permission for, which are the automatic ones.
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === 'loading') {
      setBadge(tabId, 'original');
      try {
        browser.pageAction?.show?.(tabId);
      } catch {}
    } else if (change.status === 'complete' && tab.url) {
      void translateAutomatically(tabId, tab.url);
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

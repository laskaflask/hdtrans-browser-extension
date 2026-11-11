import { matchingRules, rulesToTsv, type DictRule } from '@/lib/dictionary';
import { extensionFiles, lazyEngine } from '@/lib/engine';
import { MENU_TOGGLE, menuTitleFor } from '@/lib/menu';
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
import { ALL_ORIGINS, frameKey, grantedFor, matchSite, originPattern, sitePatterns } from '@/lib/sites';
import {
  autoSitesItem,
  dictRulesItem,
  frameOriginsItem,
  getSettings,
  pendingSitesItem,
  updateSites,
} from '@/lib/storage';

const OFFSCREEN_PATH = '/offscreen.html';
const tabStates = new Map<number, PageState>();

export default defineBackground(() => {
  // Firefox for Android has no context menus or keyboard shortcuts; the popup still works.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus?.removeAll(() => {
      browser.contextMenus.create({
        id: MENU_TOGGLE,
        title: 'hdTrans로 번역하기',
        contexts: ['page', 'selection', 'link', 'image'],
      });
    });
  });

  // One item that translates an untranslated page and restores a translated (or translating) one,
  // which is what the page itself does with toggle-page. A second item would make the browser put
  // both in a submenu named after the extension, so the reason an embed stayed in Japanese goes
  // into this item's title instead (and into the notice on the page).
  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_TOGGLE || !tab?.id) return;
    void sendToPage(tab.id, { type: 'toggle-page' });
  });

  // The menu is shared by every tab, so its title follows the active tab of the focused window.
  browser.tabs.onActivated.addListener(() => void refreshMenu());
  browser.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
  });
  browser.windows?.onFocusChanged.addListener(() => void refreshMenu());

  browser.commands?.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-translation' || !tab?.id) return;
    void sendToPage(tab.id, { type: 'toggle-page' });
  });

  browser.runtime.onMessage.addListener((msg: BackgroundRequest | UiRequest, sender, sendResponse) => {
    switch (msg?.type) {
      case 'translate-batch': {
        const url = sender.tab?.url ?? sender.url ?? '';
        translateBatch(url, sender.url, msg.lines).then(sendResponse);
        return true;
      }
      case 'page-state':
        if (sender.tab?.id && sender.frameId === 0) {
          setBadge(sender.tab.id, msg.state);
          if (sender.tab.active) void refreshMenu();
          if (msg.state === 'original') {
            void browser.tabs.sendMessage(sender.tab.id, { type: 'restore-page' } satisfies ContentRequest).catch(() => {});
          }
        }
        return;
      case 'translate-frames':
        if (!sender.tab?.id) {
          sendResponse([]);
          return;
        }
        if (sender.frameId !== 0) {
          retryEmbeds(sender.tab.id).then(() => sendResponse([]));
          return true;
        }
        translateSubframes(sender.tab.id, msg.skip).then(sendResponse);
        return true;
      case 'missing-frame-origins':
        missingFrameOrigins(msg.origins).then(sendResponse);
        return true;
      case 'open-embed-permissions':
        if (sender.tab?.id) void openEmbedPermissions(sender.tab.id);
        return;
      case 'ui-translate-tab':
        sendToPage(msg.tabId, { type: msg.action }).then(sendResponse);
        return true;
      case 'ui-translate-frames':
        retryEmbeds(msg.tabId).then(() => sendResponse([]));
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

  // The permission prompt can close the popup before it hears the answer. Remember which origins
  // were granted for embeds, and translate the frames of tabs already translating.
  browser.permissions.onAdded.addListener(({ origins = [] }) => void permissionsAdded(origins));
  // A site whose permission the user took back in the browser is no longer chosen, so a later
  // grant of broader access does not bring it back. The same goes for an embed origin.
  browser.permissions.onRemoved.addListener(({ origins = [] }) => {
    void dropRevokedSites();
    void dropRevokedOrigins(origins);
    void refreshMenu();
  });

  dictRulesItem.watch((rules) => {
    cachedRules = rules;
  });
});

let cachedRules: DictRule[] | undefined;

async function userDictFor(url: string, frameUrl?: string): Promise<string> {
  cachedRules ??= await dictRulesItem.getValue();
  return rulesToTsv(matchingRules(cachedRules, url, frameUrl));
}

async function translateBatch(url: string, frameUrl: string | undefined, lines: string[]): Promise<TranslateBatchResponse> {
  const [userDict, settings] = await Promise.all([userDictFor(url, frameUrl), getSettings()]);
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
  await creatingOffscreen;
  const url = browser.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length) {
    await creatingOffscreen;
    return;
  }
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

async function permissionsAdded(origins: string[]): Promise<void> {
  await savePendingSites(origins);
  await rememberFrameOrigins(origins);
  if (!origins.length) return;
  void translateOpenTabs();
  void refreshMenu();
}

/** Saves the pending sites these origins were granted for. */
async function savePendingSites(origins: string[]): Promise<void> {
  const granted = (await pendingSitesItem.getValue()).filter((site) => grantedFor(site, origins));
  if (!granted.length) return;
  await updateSites(autoSitesItem, (sites) => [...sites, ...granted]);
  await updateSites(pendingSitesItem, (sites) => sites.filter((s) => !granted.includes(s)));
}

/** Origins granted for cross-origin frames, kept apart from the automatic sites' permissions. */
async function rememberFrameOrigins(origins: string[]): Promise<void> {
  const siteOrigins = new Set((await autoSitesItem.getValue()).flatMap(sitePatterns));
  const frames = origins.filter((origin) => !siteOrigins.has(origin) && !ALL_ORIGINS.includes(origin));
  if (frames.length) await updateSites(frameOriginsItem, (saved) => [...saved, ...frames]);
}

async function dropRevokedOrigins(removed: string[]): Promise<void> {
  const broad = await browser.permissions.contains({ origins: ALL_ORIGINS }).catch(() => false);
  const saved = await frameOriginsItem.getValue();
  const kept: string[] = [];
  for (const pattern of saved) {
    if (removed.includes(pattern)) continue;
    if (broad || (await browser.permissions.contains({ origins: [pattern] }))) kept.push(pattern);
  }
  if (kept.length !== saved.length) await frameOriginsItem.setValue(kept);
}

/** The frame origin patterns these origins cover that the extension may not read yet. */
async function missingFrameOrigins(origins: readonly string[]): Promise<string[]> {
  const patterns = origins
    .map((origin) => originPattern(origin))
    .filter((pattern): pattern is string => !!pattern);
  const missing: string[] = [];
  for (const pattern of patterns) {
    if (!(await browser.permissions.contains({ origins: [pattern] }))) missing.push(pattern);
  }
  return missing;
}

async function dropRevokedSites(): Promise<void> {
  const sites = await autoSitesItem.getValue();
  const kept: string[] = [];
  for (const site of sites) {
    if (await browser.permissions.contains({ origins: sitePatterns(site) })) kept.push(site);
  }
  if (kept.length !== sites.length) await autoSitesItem.setValue(kept);
}

/** Opens the popup in a helper tab so the user can allow embed origins without the toolbar icon. */
async function openEmbedPermissions(tabId: number): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL(`/popup.html?tabId=${tabId}`) });
}

/** Injects the page script on first use (activeTab grants access after a menu or popup click). */
async function sendToPage(tabId: number, msg: ContentRequest): Promise<ContentStatus> {
  let status: ContentStatus | undefined;
  try {
    status = await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    // Not injected yet.
  }
  if (!status) {
    try {
      // Only the top document: activeTab covers it. The page asks for its frames itself, with
      // the addresses it opted out of, and their origins are allowed separately.
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/translator.js'] });
      status = await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
    } catch (error) {
      return { state: 'original', done: 0, total: 0, error: `이 페이지에서는 번역할 수 없습니다. (${String(error)})` };
    }
  }
  // The page itself asks for its subframes once it knows which ones to translate and which the
  // page opted out of, so they are not injected here (that could reach an opted-out frame first).
  status ??= { state: 'original', done: 0, total: 0 };
  if (msg.type !== 'get-state' && status.state === 'original') {
    void browser.tabs.sendMessage(tabId, { type: 'restore-page' } satisfies ContentRequest).catch(() => {});
  }
  return status;
}

/** Injects the content script into the tab's accessible frames, except the ones the page opted
 *  out of, and translates them. Frames the extension may not read are silently left out. */
async function translateSubframes(tabId: number, skip: readonly string[] = []): Promise<ContentStatus[]> {
  let frames: { id: number }[] = [];
  try {
    // Reading each frame's address and same-origin frameElement first tells us which frames are
    // really there and not opted out, so an opted-out frame is never injected. `skip` holds the
    // cross-origin addresses the page marked translate="no".
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const optedOut = (el: Element) =>
          el.getAttribute('translate') === 'no' || el.classList.contains('notranslate');
        const skipEl = (el: Element) =>
          /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|KBD|SAMP|VAR|SVG|MATH|CANVAS|TEMPLATE)$/i.test(el.tagName) ||
          optedOut(el) ||
          (el instanceof HTMLElement && el.isContentEditable);
        if (
          (document.documentElement && optedOut(document.documentElement)) ||
          (document.body && optedOut(document.body))
        ) {
          return null;
        }
        for (let w: Window = window; w !== w.top; ) {
          let frame: Element | null = null;
          try {
            frame = w.frameElement;
          } catch {
            break;
          }
          if (!frame) break;
          for (let e: Element | null = frame; e; e = e.parentElement) {
            if (skipEl(e)) return null;
          }
          w = w.parent;
        }
        return location.href;
      },
    });
    const skipped = new Set(skip.map(frameKey));
    frames = results
      .filter((r) => r.frameId !== 0 && typeof r.result === 'string' && !skipped.has(frameKey(r.result)))
      .map((r) => ({ id: r.frameId }));
  } catch {
    return [];
  }
  if (!frames.length) return [];
  try {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: frames.map((frame) => frame.id) },
      files: ['/content-scripts/translator.js'],
    });
  } catch {
    // A frame may have gone away; the messages below simply skip it.
  }
  const statuses = await Promise.all(
    frames.map((frame) =>
      browser.tabs
        .sendMessage(tabId, { type: 'translate-page', wait: true } satisfies ContentRequest, { frameId: frame.id })
        .catch(() => undefined),
    ),
  );
  return statuses.filter((s): s is ContentStatus => !!s);
}

/** Asks a translated page to try its subframes again. The page knows which frames it opted out
 *  of, so only the background's injection list carries that decision. */
async function retryEmbeds(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'translate-embeds' } satisfies ContentRequest, { frameId: 0 });
  } catch {
    // No page script there; nothing to retry.
  }
}

/** Tries embeds again in tabs that were already translating when host access was granted. */
async function translateOpenTabs(): Promise<void> {
  const tabs = await browser.tabs.query({}).catch(() => []);
  const ids = new Set<number>([...tabStates.keys(), ...tabs.flatMap((t) => (t.id ? [t.id] : []))]);
  for (const tabId of ids) {
    if ((await pageState(tabId)) !== 'original') void retryEmbeds(tabId);
  }
}

/** The state of a tab's page. Only asks a page script that is already there; a page without one is untranslated. */
async function pageStatus(tabId: number): Promise<ContentStatus> {
  try {
    const status: ContentStatus | undefined = await browser.tabs.sendMessage(tabId, { type: 'get-state' }, { frameId: 0 });
    return status ?? { state: 'original', done: 0, total: 0 };
  } catch {
    return { state: 'original', done: 0, total: 0 };
  }
}

async function pageState(tabId: number): Promise<PageState> {
  return (await pageStatus(tabId)).state;
}

/** Sets a loaded tab's badge, and the menu if the tab is active, from the state of its page. */
async function syncTab(tabId: number, active: boolean): Promise<PageState> {
  const state = await pageState(tabId);
  setBadge(tabId, state);
  if (active) void refreshMenu();
  return state;
}

let menuRefresh = 0;

/** Sets the menu item's title from the focused window's active tab. */
async function refreshMenu(): Promise<void> {
  if (!browser.contextMenus) return;
  const refresh = ++menuRefresh;
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const status = tab?.id ? await pageStatus(tab.id) : { state: 'original' as PageState, done: 0, total: 0 };
  const missing = tab?.id && status.state === 'translated' ? await missingFrameOrigins(status.frameOrigins ?? []) : [];
  // A later refresh has already answered for a newer tab or state.
  if (refresh !== menuRefresh) return;
  browser.contextMenus.update(MENU_TOGGLE, { title: menuTitleFor(status.state, missing.length) }).catch(() => {});
}

function setBadge(tabId: number, state: ContentStatus['state']): void {
  tabStates.set(tabId, state);
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

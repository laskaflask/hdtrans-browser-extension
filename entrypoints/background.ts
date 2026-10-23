import { matchingRules, rulesToTsv, type DictRule } from '@/lib/dictionary';
import type {
  BackgroundRequest,
  ContentRequest,
  ContentStatus,
  OffscreenRequest,
  OffscreenResponse,
  TranslateBatchResponse,
  UiRequest,
} from '@/lib/messages';
import { dictRulesItem, getSettings } from '@/lib/storage';

const MENU_TRANSLATE = 'hdtrans-translate-page';
const MENU_RESTORE = 'hdtrans-restore-page';
const OFFSCREEN_PATH = '/offscreen.html';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({ id: MENU_TRANSLATE, title: '페이지 전체 번역', contexts: ['page', 'selection', 'link', 'image'] });
      browser.contextMenus.create({ id: MENU_RESTORE, title: '원래대로 복원', contexts: ['page', 'selection', 'link', 'image'] });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const action = info.menuItemId === MENU_RESTORE ? 'restore-page' : 'translate-page';
    void sendToPage(tab.id, { type: action });
  });

  browser.commands.onCommand.addListener((command, tab) => {
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
        callEngine({ target: 'offscreen', type: 'check-userdict', userDict: msg.userDict }).then(sendResponse);
        return true;
      case 'ui-engine-info':
        callEngine({ target: 'offscreen', type: 'info' }).then(sendResponse);
        return true;
    }
  });

  // A navigation drops the page's translation, so drop its badge too.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') setBadge(tabId, 'original');
  });

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
  return callEngine({ target: 'offscreen', type: 'translate', lines, userDict, speech: settings.speech });
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

async function callEngine(msg: OffscreenRequest): Promise<OffscreenResponse> {
  try {
    await ensureOffscreen();
    const response: OffscreenResponse | undefined = await browser.runtime.sendMessage(msg);
    return response ?? { error: '번역 엔진이 응답하지 않았습니다.' };
  } catch (error) {
    return { error: String(error) };
  }
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
  browser.action.setBadgeText({ tabId, text }).catch(() => {});
  browser.action.setBadgeBackgroundColor({ tabId, color: '#2f6fed' }).catch(() => {});
}

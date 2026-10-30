import '@/assets/base.css';
import './style.css';
import { h } from '@/lib/dom';
import { matchingRules, MATCH_TYPE_LABELS } from '@/lib/dictionary';
import type { ContentStatus, UiRequest } from '@/lib/messages';
import { matchSites, siteKey, sitePatterns } from '@/lib/sites';
import { autoSitesItem, dictRulesItem, getSettings, pendingSitesItem, settingsItem, updateSites } from '@/lib/storage';

const app = document.getElementById('app')!;

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function pageStatus(tabId: number): Promise<ContentStatus> {
  try {
    return (await browser.tabs.sendMessage(tabId, { type: 'get-state' }, { frameId: 0 })) ?? { state: 'original', done: 0, total: 0 };
  } catch {
    return { state: 'original', done: 0, total: 0 };
  }
}

async function act(tabId: number, action: 'translate-page' | 'restore-page'): Promise<ContentStatus> {
  return browser.runtime.sendMessage({ type: 'ui-translate-tab', tabId, action } satisfies UiRequest);
}

function openOptions(params = ''): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`/options.html${params}`) });
  window.close();
}

/** The chosen site that translates this address automatically (it may be a parent site of the
 *  page's own): chosen, and the browser still lets us in. */
async function autoSiteFor(url: string): Promise<string | null> {
  for (const site of matchSites(await autoSitesItem.getValue(), url)) {
    if (await browser.permissions.contains({ origins: sitePatterns(site) })) return site;
  }
  return null;
}

/** Stops translating this address automatically: every chosen site covering it, parents too. */
async function stopAutoSites(url: string): Promise<void> {
  const sites = matchSites(await autoSitesItem.getValue(), url);
  await updateSites(autoSitesItem, (all) => all.filter((s) => !sites.includes(s)));
  for (const site of sites) await browser.permissions.remove({ origins: sitePatterns(site) }).catch(() => {});
}

async function render(): Promise<void> {
  // Firefox for Android shows the popup as a full page: it gets a touch layout that fills the screen.
  const { os } = await browser.runtime.getPlatformInfo();
  document.documentElement.classList.toggle('mobile', os === 'android');
  const tab = await activeTab();
  const tabId = tab?.id;
  const url = tab?.url ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  const rules = matchingRules(await dictRulesItem.getValue(), url);
  let status: ContentStatus = tabId ? await pageStatus(tabId) : { state: 'original', done: 0, total: 0 };
  const settings = await getSettings();
  const site = siteKey(url);
  let autoSite = site ? await autoSiteFor(url) : null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const draw = (): void => {
    const busy = status.state === 'translating';
    const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
    app.replaceChildren(
      h('header', {}, h('h1', {}, 'hdTrans 일본어 → 한국어'), h('span', { class: 'muted' }, host)),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'primary',
            disabled: !tabId || status.state !== 'original',
            onclick: async () => {
              status = await act(tabId!, 'translate-page');
              draw();
              poll();
            },
          },
          busy ? '번역 중…' : status.state === 'translated' ? '번역됨' : '페이지 번역',
        ),
        h(
          'button',
          {
            disabled: !tabId || status.state === 'original',
            onclick: async () => {
              status = await act(tabId!, 'restore-page');
              draw();
            },
          },
          '원래대로',
        ),
      ),
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: settings.bilingual,
          // A translated page redraws itself when the setting changes.
          onchange: async (e: Event) => {
            settings.bilingual = (e.target as HTMLInputElement).checked;
            await settingsItem.setValue(settings);
            if (!tabId || status.state === 'original') return;
            await new Promise((resolve) => setTimeout(resolve, 100));
            status = await pageStatus(tabId);
            draw();
            poll();
          },
        }),
        h('span', { class: 'track' }),
        '원문과 함께 표시',
      ),
      site
        ? h(
            'div',
            { class: 'auto' },
            h(
              'label',
              { class: 'switch' },
              h('input', {
                type: 'checkbox',
                role: 'switch',
                checked: !!autoSite,
                onchange: async (e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const on = input.checked;
                  // The browser takes a permission request only straight from the user's click, so
                  // it goes first, before anything is awaited.
                  const request = on ? browser.permissions.request({ origins: sitePatterns(site) }) : undefined;
                  if (on) {
                    // Pending until answered: the prompt can close this popup, and then the background
                    // saves the site once the browser grants it.
                    await updateSites(pendingSitesItem, (sites) => [...sites, site]);
                    const granted = await request!.catch(() => false);
                    await updateSites(pendingSitesItem, (sites) => sites.filter((s) => s !== site));
                    if (!granted) {
                      input.checked = false;
                      return;
                    }
                    await updateSites(autoSitesItem, (sites) => [...sites, site]);
                    autoSite = site;
                    if (tabId && status.state === 'original') {
                      status = await act(tabId, 'translate-page');
                      poll();
                    }
                  } else {
                    await stopAutoSites(url);
                    autoSite = null;
                  }
                  draw();
                },
              }),
              h('span', { class: 'track' }),
              '이 사이트는 항상 자동 번역',
            ),
            h(
              'div',
              { class: 'muted' },
              autoSite
                ? `${autoSite} 및 하위 사이트를 열면 자동으로 번역합니다.`
                : status.state === 'original'
                  ? ''
                  : '켜면 이 사이트에서만 접근 권한을 요청합니다.',
            ),
          )
        : '',
      busy ? h('div', { class: 'progress' }, h('div', { style: `width:${pct}%` })) : '',
      status.error ? h('div', { class: 'error' }, status.error) : '',
      status.userDictWarning ? h('div', { class: 'warn' }, `사용자 사전 오류\n${status.userDictWarning}`) : '',
      h('div', {}, h('div', { class: 'muted' }, `이 페이지에 적용되는 사전 ${rules.length}개`)),
      rules.length
        ? h(
            'ul',
            { class: 'rules' },
            rules.map((r) => h('li', {}, `${r.name} `, h('span', { class: 'muted' }, `(${MATCH_TYPE_LABELS[r.matchType]}, ${r.entries.length}개)`))),
          )
        : '',
      h(
        'footer',
        {},
        h('a', { onclick: () => openOptions(host ? `?newHost=${encodeURIComponent(host)}` : '') }, '+ 이 사이트 사전 만들기'),
        h('a', { onclick: () => openOptions() }, '설정'),
      ),
    );
  };

  const poll = (): void => {
    clearInterval(timer);
    if (!tabId || status.state !== 'translating') return;
    timer = setInterval(async () => {
      status = await pageStatus(tabId);
      draw();
      if (status.state !== 'translating') clearInterval(timer);
    }, 300);
  };

  draw();
  poll();
}

void render();

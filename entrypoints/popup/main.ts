import '@/assets/base.css';
import './style.css';
import { h } from '@/lib/dom';
import { matchingRules, MATCH_TYPE_LABELS } from '@/lib/dictionary';
import type { ContentStatus, UiRequest } from '@/lib/messages';
import { dictRulesItem } from '@/lib/storage';

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

async function render(): Promise<void> {
  const tab = await activeTab();
  const tabId = tab?.id;
  const url = tab?.url ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  const rules = matchingRules(await dictRulesItem.getValue(), url);
  let status: ContentStatus = tabId ? await pageStatus(tabId) : { state: 'original', done: 0, total: 0 };
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

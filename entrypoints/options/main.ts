import '@/assets/base.css';
import './style.css';
import { h } from '@/lib/dom';
import {
  MATCH_TYPE_LABELS,
  newRule,
  parseTsv,
  ruleMatches,
  rulesToTsv,
  validatePattern,
  type DictEntry,
  type DictRule,
  type MatchType,
} from '@/lib/dictionary';
import type { EngineResponse, UiRequest } from '@/lib/messages';
import { ALL_ORIGINS, sitePatterns } from '@/lib/sites';
import {
  autoSitesItem,
  dictRulesItem,
  frameOriginsItem,
  getSettings,
  settingsItem,
  updateSites,
  type Settings,
} from '@/lib/storage';

const POS = ['n', 'phrase', 'name', 'surname', 'intj', 'lead', 'hon', 'v', 'v1', 'v5', 'adj', 'na', 'adv', 'ono', 'end', 'pat'];
const PATTERN_HINTS: Record<MatchType, string> = {
  all: '모든 페이지에 적용합니다.',
  host: '예: syosetu.com — 하위 도메인(ncode.syosetu.com)도 포함합니다.',
  prefix: '예: https://ncode.syosetu.com/n1234ab/',
  glob: '예: https://kakuyomu.jp/works/*/episodes/*',
  regex: '예: ^https://example\\.jp/(news|blog)/',
};

const SOURCE_URL = 'https://github.com/laskaflask/hdtrans-browser-extension';

const app = document.getElementById('app')!;

let rules: DictRule[] = [];
let selectedId: string | undefined;
let dirty = false;
let message: { text: string; kind: 'ok' | 'error' | 'warn' } | undefined;
let testUrl = '';
let engineInfo = '';

function send<T>(msg: UiRequest): Promise<T> {
  return browser.runtime.sendMessage(msg);
}

function selected(): DictRule | undefined {
  return rules.find((r) => r.id === selectedId);
}

function markDirty(): void {
  dirty = true;
  message = undefined;
  renderStatus();
}

// Settings save on change; dictionaries save with the button so a half-edited row is not applied.
function settingsSection(settings: Settings): HTMLElement {
  const update = async (patch: Partial<Settings>) => {
    Object.assign(settings, patch);
    await settingsItem.setValue(settings);
  };
  return h(
    'section',
    {},
    h('h2', {}, '번역 설정'),
    h(
      'div',
      { class: 'settings' },
      h(
        'label',
        {},
        '대사(「」) 말투',
        h(
          'select',
          { onchange: (e: Event) => update({ speech: (e.target as HTMLSelectElement).value as Settings['speech'] }) },
          h('option', { value: 'strict', selected: settings.speech === 'strict' }, '기본 (내일 간다)'),
          h('option', { value: 'soft', selected: settings.speech === 'soft' }, '부드럽게 (내일 갈 거야)'),
        ),
      ),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: settings.translateAttributes,
          onchange: (e: Event) => update({ translateAttributes: (e.target as HTMLInputElement).checked }),
        }),
        '이미지 설명, 툴팁, 입력 안내문(alt, title, placeholder)도 번역',
      ),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: settings.observeMutations,
          onchange: (e: Event) => update({ observeMutations: (e.target as HTMLInputElement).checked }),
        }),
        '번역한 뒤 새로 나타나는 내용도 번역',
      ),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: settings.bilingual,
          onchange: (e: Event) => update({ bilingual: (e.target as HTMLInputElement).checked }),
        }),
        '원문과 번역문을 함께 표시',
      ),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: settings.showProgress,
          onchange: (e: Event) => update({ showProgress: (e.target as HTMLInputElement).checked }),
        }),
        '번역을 기다리는 문장을 깜빡여 표시',
      ),
    ),
  );
}

const sitesRoot = h('section', {});

function hostOf(pattern: string): string {
  try {
    return new URL(pattern.replace(/\*$/, '')).host;
  } catch {
    return pattern;
  }
}

/** A site or embed origin the browser lets the extension read, with a way to revoke it. */
function permissionRow(label: string, kind: string, action: string, revoke: () => Promise<void>): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('span', { class: 'grow' }, label, h('span', { class: 'muted' }, ` · ${kind}`)),
    h('button', { class: 'small danger', onclick: () => void revoke() }, action),
  );
}

/** Lists the host permissions granted per site (automatic translation) or per embed origin,
 *  and offers the optional all-sites exception at the bottom. */
async function renderSiteAccess(): Promise<void> {
  const broad = await browser.permissions.contains({ origins: ALL_ORIGINS }).catch(() => false);
  const autoSites = await autoSitesItem.getValue();
  const keptSites: string[] = [];
  for (const site of autoSites) {
    if (await browser.permissions.contains({ origins: sitePatterns(site) })) keptSites.push(site);
  }
  if (keptSites.length !== autoSites.length) await autoSitesItem.setValue(keptSites);

  const savedOrigins = await frameOriginsItem.getValue();
  const keptOrigins: string[] = [];
  if (!broad) {
    for (const pattern of savedOrigins) {
      if (await browser.permissions.contains({ origins: [pattern] })) keptOrigins.push(pattern);
    }
    if (keptOrigins.length !== savedOrigins.length) await frameOriginsItem.setValue(keptOrigins);
  }

  const rows: HTMLElement[] = [
    ...keptSites.map((site) =>
      permissionRow(site, '자동 번역', '자동 번역 끄기', async () => {
        await updateSites(autoSitesItem, (sites) => sites.filter((s) => s !== site));
        if (!broad) await browser.permissions.remove({ origins: sitePatterns(site) }).catch(() => false);
        await renderSiteAccess();
      }),
    ),
    ...(broad
      ? []
      : keptOrigins.map((pattern) =>
          permissionRow(hostOf(pattern), '임베드', '권한 취소', async () => {
            await browser.permissions.remove({ origins: [pattern] }).catch(() => false);
            await frameOriginsItem.setValue((await frameOriginsItem.getValue()).filter((p) => p !== pattern));
            await renderSiteAccess();
          }),
        )),
  ];

  sitesRoot.replaceChildren(
    h('h2', {}, '사이트 접근 권한'),
    h(
      'div',
      { class: 'muted' },
      'hdTrans는 최소 권한 원칙에 따라 기본적으로 어떤 사이트의 접근 권한도 요구하지 않으며, 번역을 요청한 탭에서만 일시적으로 동작합니다. 사이트별 자동 번역이나 외부 임베드(iframe) 번역을 위해 직접 허용한 권한만 아래에 표시되며, 언제든 취소할 수 있습니다.',
    ),
    h(
      'div',
      { class: 'settings' },
      ...(broad && rows.length
        ? [h('div', { class: 'muted' }, '모든 페이지 접근 권한이 허용되어 있어 임베드 출처별 허용은 따로 필요하지 않습니다.')]
        : []),
      ...(rows.length
        ? rows
        : [
            h(
              'div',
              { class: 'muted' },
              broad
                ? '자동 번역하도록 선택한 사이트가 없습니다. (모든 페이지 접근 권한이 있어 임베드 출처는 개별 허용 없이 번역됩니다.)'
                : '현재 사이트별로 허용한 접근 권한이 없습니다.',
            ),
          ]),
      h(
        'div',
        { class: 'access-all' },
        h(
          'span',
          { class: 'muted' },
          broad
            ? '예외적으로 모든 페이지(http/https) 접근 권한이 허용되어 있습니다. 임베드 출처나 자동 번역 사이트마다 권한을 따로 묻지 않습니다.'
            : '최소 권한 원칙상 기본값은 아니지만, 사이트나 임베드마다 권한을 허용하는 과정이 번거롭다면 예외적으로 모든 페이지 접근 권한을 미리 허용할 수 있습니다. (자동 번역 여부는 여전히 사이트별로 설정합니다.)',
        ),
        h(
          'button',
          {
            class: broad ? 'small danger' : 'small',
            onclick: async () => {
              if (broad) {
                await browser.permissions.remove({ origins: ALL_ORIGINS });
              } else {
                // The browser takes the request only straight from this click, before any await.
                const ok = await browser.permissions.request({ origins: ALL_ORIGINS }).catch(() => false);
                if (!ok) return;
              }
              await renderSiteAccess();
            },
          },
          broad ? '전체 사이트 권한 취소' : '모든 페이지 접근 허용',
        ),
      ),
    ),
  );
}

function ruleList(): HTMLElement {
  return h(
    'div',
    { class: 'rule-list' },
    rules.map((rule) =>
      h(
        'button',
        {
          class: `rule-item${rule.id === selectedId ? ' active' : ''}${rule.enabled ? '' : ' off'}`,
          onclick: () => {
            selectedId = rule.id;
            renderDicts();
          },
        },
        h('span', { class: 'name' }, rule.name || '(이름 없음)'),
        h('small', {}, `${MATCH_TYPE_LABELS[rule.matchType]}${rule.matchType === 'all' ? '' : ` · ${rule.pattern}`} · ${rule.entries.length}개`),
      ),
    ),
    h(
      'button',
      {
        onclick: () => {
          const rule = newRule();
          rules.push(rule);
          selectedId = rule.id;
          markDirty();
          renderDicts();
        },
      },
      '+ 새 사전',
    ),
  );
}

function entryRow(rule: DictRule, entry: DictEntry): HTMLElement {
  const field = (key: keyof DictEntry, placeholder: string, extra: Record<string, unknown> = {}) =>
    h('input', {
      value: entry[key] ?? '',
      placeholder,
      ...extra,
      oninput: (e: Event) => {
        entry[key] = (e.target as HTMLInputElement).value;
        markDirty();
      },
    });
  return h(
    'tr',
    {},
    h('td', { class: 'ja' }, field('ja', '日本語')),
    h('td', { class: 'ko' }, field('ko', '한국어')),
    h('td', { class: 'pos' }, field('pos', '품사 (n)', { list: 'pos-list' })),
    h('td', { class: 'opts' }, field('options', '옵션')),
    h(
      'td',
      { class: 'del' },
      h(
        'button',
        {
          class: 'danger',
          title: '행 삭제',
          onclick: () => {
            rule.entries.splice(rule.entries.indexOf(entry), 1);
            markDirty();
            renderDicts();
          },
        },
        '×',
      ),
    ),
  );
}

function editor(rule: DictRule): HTMLElement {
  const index = rules.indexOf(rule);
  const patternError = validatePattern(rule.matchType, rule.pattern);
  const testResult = h('span', { class: 'muted' });
  const updateTest = () => {
    if (!testUrl) testResult.textContent = '';
    else if (ruleMatches(rule, testUrl)) {
      testResult.textContent = '적용됨';
      testResult.className = 'ok';
    } else {
      testResult.textContent = '적용 안 됨';
      testResult.className = 'error';
    }
  };
  updateTest();
  const tsvBox = h('textarea', { placeholder: '日本語<TAB>한국어<TAB>품사<TAB>옵션 — 한 줄에 하나', spellcheck: false });

  return h(
    'div',
    { class: 'editor' },
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'field grow' },
        h('span', {}, '이름'),
        h('input', {
          value: rule.name,
          oninput: (e: Event) => {
            rule.name = (e.target as HTMLInputElement).value;
            markDirty();
          },
          onchange: () => renderDicts(),
        }),
      ),
      h(
        'label',
        { class: 'row', style: 'align-self:end' },
        h('input', {
          type: 'checkbox',
          checked: rule.enabled,
          onchange: (e: Event) => {
            rule.enabled = (e.target as HTMLInputElement).checked;
            markDirty();
            renderDicts();
          },
        }),
        '사용',
      ),
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'field' },
        h('span', {}, '적용 범위'),
        h(
          'select',
          {
            onchange: (e: Event) => {
              rule.matchType = (e.target as HTMLSelectElement).value as MatchType;
              markDirty();
              renderDicts();
            },
          },
          (Object.keys(MATCH_TYPE_LABELS) as MatchType[]).map((t) =>
            h('option', { value: t, selected: t === rule.matchType }, MATCH_TYPE_LABELS[t]),
          ),
        ),
      ),
      rule.matchType !== 'all' &&
        h(
          'label',
          { class: 'field grow' },
          h('span', {}, '패턴'),
          h('input', {
            value: rule.pattern,
            spellcheck: false,
            oninput: (e: Event) => {
              rule.pattern = (e.target as HTMLInputElement).value;
              markDirty();
              updateTest();
            },
            onchange: () => renderDicts(),
          }),
        ),
    ),
    h('div', { class: patternError ? 'error' : 'muted' }, patternError || PATTERN_HINTS[rule.matchType]),
    rule.matchType !== 'all' &&
      h(
        'div',
        { class: 'row' },
        h(
          'label',
          { class: 'field grow' },
          h('span', {}, '주소로 확인'),
          h('input', {
            value: testUrl,
            placeholder: 'https://…',
            oninput: (e: Event) => {
              testUrl = (e.target as HTMLInputElement).value.trim();
              updateTest();
            },
          }),
        ),
        h('div', { style: 'align-self:end;padding-bottom:6px' }, testResult),
      ),
    h(
      'div',
      { class: 'entries' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, '일본어'), h('th', {}, '한국어'), h('th', {}, '품사'), h('th', {}, '옵션'), h('th', {}))),
        h('tbody', {}, rule.entries.map((entry) => entryRow(rule, entry))),
      ),
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          onclick: () => {
            rule.entries.push({ ja: '', ko: '' });
            markDirty();
            renderDicts();
            const inputs = app.querySelectorAll<HTMLInputElement>('.entries tbody tr:last-child input');
            inputs[0]?.focus();
          },
        },
        '+ 행 추가',
      ),
      h('span', { class: 'muted' }, '품사를 비우면 명사입니다. 이름은 name, 성은 surname, 동사는 v/v1/v5.'),
    ),
    h(
      'details',
      {},
      h('summary', {}, 'TSV로 붙여넣기 / 내보내기'),
      h(
        'div',
        { class: 'field', style: 'margin-top:8px' },
        tsvBox,
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              onclick: () => {
                const added = parseTsv(tsvBox.value);
                rule.entries.push(...added);
                tsvBox.value = '';
                markDirty();
                renderDicts();
              },
            },
            '아래에 추가',
          ),
          h(
            'button',
            {
              onclick: () => {
                rule.entries = parseTsv(tsvBox.value);
                markDirty();
                renderDicts();
              },
            },
            '전체 바꾸기',
          ),
          h(
            'button',
            {
              onclick: () => {
                tsvBox.value = rulesToTsv([{ ...rule, name: '' }]).replace(/^# .*\n/, '');
              },
            },
            '현재 항목 내보내기',
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          disabled: index === 0,
          onclick: () => {
            moveRule(index, -1);
            renderDicts();
          },
        },
        '↑ 위로',
      ),
      h(
        'button',
        {
          disabled: index === rules.length - 1,
          onclick: () => {
            moveRule(index, 1);
            renderDicts();
          },
        },
        '↓ 아래로',
      ),
      h('span', { class: 'muted grow' }, '같은 단어가 여러 사전에 있으면 아래쪽 사전이 우선합니다. ‘모든 사이트’ 사전은 항상 먼저 적용됩니다.'),
      h(
        'button',
        {
          class: 'danger',
          onclick: () => {
            if (!confirm(`‘${rule.name}’ 사전을 삭제할까요?`)) return;
            rules.splice(index, 1);
            selectedId = rules[Math.min(index, rules.length - 1)]?.id;
            markDirty();
            renderDicts();
          },
        },
        '사전 삭제',
      ),
    ),
  );
}

function moveRule(index: number, delta: number): void {
  const [rule] = rules.splice(index, 1);
  if (rule) rules.splice(index + delta, 0, rule);
  markDirty();
}

async function save(): Promise<void> {
  const invalid = rules.find((r) => validatePattern(r.matchType, r.pattern));
  if (invalid) {
    selectedId = invalid.id;
    message = { text: `‘${invalid.name}’의 패턴을 확인하세요.`, kind: 'error' };
    renderDicts();
    return;
  }
  for (const rule of rules) rule.entries = rule.entries.filter((e) => e.ja.trim() || e.ko.trim());
  statusLine.replaceChildren(h('span', { class: 'muted' }, '엔진으로 사전을 확인하는 중…'));
  // Let the engine parse each dictionary; rows it rejects are reported, the rest still apply.
  const warnings: string[] = [];
  for (const rule of rules.filter((r) => r.entries.length)) {
    const res = await send<EngineResponse>({ type: 'ui-check-userdict', userDict: rulesToTsv([rule]) });
    if (res.error) warnings.push(`엔진 확인 실패: ${res.error}`);
    else if (res.userDictWarning) warnings.push(`${rule.name}\n${res.userDictWarning.replace(/^(\d+):/gm, (_, n) => `  ${Number(n) - 1}번째 행:`)}`);
  }
  await dictRulesItem.setValue(rules);
  dirty = false;
  message = warnings.length
    ? { text: `저장했습니다. 다음 행은 엔진이 읽지 못해 무시됩니다.\n${warnings.join('\n')}`, kind: 'warn' }
    : { text: '저장했습니다. 다음 번역부터 적용됩니다.', kind: 'ok' };
  renderDicts();
}

const dictsRoot = h('section', {});
const statusLine = h('div', { class: 'status' });

function renderStatus(): void {
  statusLine.replaceChildren(
    message
      ? h('div', { class: message.kind === 'warn' ? 'warn' : message.kind }, message.text)
      : dirty
        ? h('span', { class: 'muted' }, '저장하지 않은 변경이 있습니다.')
        : '',
  );
}

function renderDicts(): void {
  const rule = selected();
  dictsRoot.replaceChildren(
    h(
      'div',
      { class: 'row', style: 'justify-content:space-between' },
      h('h2', { style: 'margin:0' }, '사용자 사전'),
      h('button', { class: 'primary', onclick: () => void save() }, '저장'),
    ),
    statusLine,
    h(
      'div',
      { class: 'dicts' },
      ruleList(),
      rule ? editor(rule) : h('div', { class: 'empty' }, '사전을 만들면 사이트나 주소 패턴별로 단어 번역을 지정할 수 있습니다.'),
    ),
  );
  renderStatus();
}

// AGPL: users of the extension get the license and where its source is.
function licenseFooter(): HTMLElement {
  const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  return h(
    'footer',
    { class: 'license muted' },
    'AGPL-3.0 이후 버전으로 배포합니다. ',
    link('/LICENSE.txt', '라이선스'),
    ' · ',
    link('/THIRD-PARTY-NOTICES.txt', '제3자 고지'),
    ' · ',
    link(SOURCE_URL, '소스 코드'),
  );
}

async function main(): Promise<void> {
  const settings = await getSettings();
  rules = await dictRulesItem.getValue();
  const params = new URLSearchParams(location.search);
  const newHost = params.get('newHost');
  if (newHost) {
    const existing = rules.find((r) => r.matchType === 'host' && r.pattern === newHost);
    if (existing) selectedId = existing.id;
    else {
      const rule = newRule({ name: newHost, matchType: 'host', pattern: newHost, entries: [{ ja: '', ko: '' }] });
      rules.push(rule);
      selectedId = rule.id;
      dirty = true;
    }
    testUrl = `https://${newHost}/`;
    history.replaceState(null, '', location.pathname);
  }
  selectedId ??= rules[0]?.id;

  const version = h('span', { class: 'muted' }, '엔진 불러오는 중…');
  app.replaceChildren(
    h('header', {}, h('h1', {}, 'hdTrans 일본어 → 한국어'), version),
    settingsSection(settings),
    dictsRoot,
    sitesRoot,
    h('datalist', { id: 'pos-list' }, POS.map((p) => h('option', { value: p }))),
    licenseFooter(),
  );
  renderDicts();
  if (newHost) {
    const inputs = app.querySelectorAll<HTMLInputElement>('.entries tbody tr:last-child input');
    inputs[0]?.focus();
  }
  void renderSiteAccess();
  // A permission granted or taken back in the browser updates the stored lists from the background.
  autoSitesItem.watch(() => void renderSiteAccess());
  frameOriginsItem.watch(() => void renderSiteAccess());
  browser.permissions.onAdded.addListener(() => void renderSiteAccess());
  browser.permissions.onRemoved.addListener(() => void renderSiteAccess());

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  const info = await send<EngineResponse>({ type: 'ui-engine-info' });
  engineInfo = info.info ? `엔진 ${info.info.version} · 사전 ${info.info.dictionaryVersion}` : `엔진 오류: ${info.error}`;
  version.textContent = engineInfo;
}

void main();

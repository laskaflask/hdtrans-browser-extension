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
import { dictRulesItem, getSettings, settingsItem, type Settings } from '@/lib/storage';

const POS = ['n', 'phrase', 'name', 'surname', 'intj', 'lead', 'hon', 'v', 'v1', 'v5', 'adj', 'na', 'adv', 'ono', 'end', 'pat'];
const PATTERN_HINTS: Record<MatchType, string> = {
  all: '모든 페이지에 적용합니다.',
  host: '예: syosetu.com — 하위 도메인(ncode.syosetu.com)도 포함합니다.',
  prefix: '예: https://ncode.syosetu.com/n1234ab/',
  glob: '예: https://kakuyomu.jp/works/*/episodes/*',
  regex: '예: ^https://example\\.jp/(news|blog)/',
};

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
          checked: settings.showProgress,
          onchange: (e: Event) => update({ showProgress: (e.target as HTMLInputElement).checked }),
        }),
        '번역을 기다리는 문장을 깜빡여 표시',
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
    h('td', {}, field('ja', '日本語')),
    h('td', {}, field('ko', '한국어')),
    h('td', { style: 'width:120px' }, field('pos', 'n', { list: 'pos-list' })),
    h('td', { style: 'width:150px' }, field('options', '')),
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
    h('datalist', { id: 'pos-list' }, POS.map((p) => h('option', { value: p }))),
  );
  renderDicts();

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  const info = await send<EngineResponse>({ type: 'ui-engine-info' });
  engineInfo = info.info ? `엔진 ${info.info.version} · 사전 ${info.info.dictionaryVersion}` : `엔진 오류: ${info.error}`;
  version.textContent = engineInfo;
}

void main();

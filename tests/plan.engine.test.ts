// Runs plans through the engine the extension ships: vendor/hdtrans/ with the npm dictionary.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, type EngineFiles } from '../lib/engine';
import { planInline, planLines, type Plan } from '../lib/text';

const vendor = resolve(__dirname, '../vendor/hdtrans');
const dist = resolve(__dirname, '../node_modules/hdtrans/dist');

const files: EngineFiles = {
  runtime: () => import(pathToFileURL(resolve(dist, 'runtime.js')).href),
  engine: () => import(pathToFileURL(resolve(vendor, 'hdtrans_engine.js')).href),
  bytes: (name) => readFile(resolve(name === 'dicts.hdsnap' ? dist : vendor, name)),
  text: (name) => readFile(resolve(dist, name), 'utf8'),
};

let engine: Engine;
beforeAll(async () => {
  engine = await Engine.load(files);
});

function run(plan: Plan): string[] | undefined {
  const res = engine.handle({ type: 'translate', lines: plan.lines, userDict: '', speech: 'strict' });
  return plan.apply(res.lines ?? []);
}

describe('shipped engine', () => {
  it('generates no code at run time (extension CSPs forbid it)', async () => {
    const source = await readFile(resolve(vendor, 'hdtrans_engine.js'), 'utf8');
    expect(source).not.toMatch(/new Function|eval\(/);
  });

  it('matches the npm package version, so the dictionary snapshot loads', async () => {
    const pkg = JSON.parse(await readFile(resolve(dist, '../package.json'), 'utf8'));
    expect(engine.handle({ type: 'info' }).info).toEqual({
      version: pkg.version,
      dictionaryVersion: (await files.text('dicts.txt')).trim(),
    });
  });

  it('applies the user dictionary and reports bad rows', () => {
    const res = engine.handle({ type: 'translate', lines: ['ユキは魔導具を使った。'], userDict: 'ユキ\t눈송이\tname\n魔導具\t마법도구\n', speech: 'strict' });
    expect(res.lines).toEqual(['눈송이는 마법도구를 썼다.']);
    expect(engine.handle({ type: 'check-userdict', userDict: '東京\t도쿄\tzzz\n' }).userDictWarning).toMatch(/^1: unknown POS/);
  });
});

describe('plans with the engine', () => {
  it('translates a sentence split by inline elements as one, keeping its spacing', () => {
    expect(run(planInline(['ユキさんは', '魔導具', 'を使った。']))).toEqual(['유키 씨는 ', '마도구', '를 썼다.']);
    expect(run(planInline(['詳しくは', 'こちら', 'をご覧ください。']))).toEqual(['자세하게는 ', '이쪽', '을 봐 주세요.']);
  });

  it('translates a word with one node per letter as a word', () => {
    const letters = [...'そういうストーリー'];
    expect(run(planInline(['これは、', ...letters, 'なのだ。']))).toEqual(['이것은, ', '그런 스토리', ...letters.slice(1).map(() => ''), '다.']);
    expect(run(planInline([...'ストーリー']))).toEqual(['스토리', '', '', '', '']);
  });

  it('keeps whitespace-only and surrounding whitespace of nodes', () => {
    expect(run(planInline(['\n  今日は', ' ', 'いい天気ですね。\n']))).toEqual(['\n  오늘은', ' ', '좋은 날씨군요.\n']);
  });

  it('translates preformatted text line by line', () => {
    expect(run(planLines(['一行目\n  二行目']))).toEqual(['1행째\n  2행째']);
  });
});

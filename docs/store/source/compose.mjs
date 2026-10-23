// Lays the raw shots out as 1280x800 store screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';

const [raw, iconDir, out] = process.argv.slice(2);
const img = (name, dir = raw) => `data:image/png;base64,${fs.readFileSync(`${dir}/${name}`).toString('base64')}`;
const icon = img('32.png', iconDir);

const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { font-family: 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', sans-serif; color: #15213b;
    background: radial-gradient(1200px 600px at 15% -10%, #dfe8ff 0%, transparent 60%),
                radial-gradient(900px 500px at 100% 0%, #ffe9dc 0%, transparent 55%), #f5f7fc; position: relative; }
  .head { position: absolute; top: 46px; left: 0; right: 0; text-align: center; }
  .pill { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #2f6fed;
    background: #fff; border-radius: 999px; padding: 6px 14px 6px 8px; box-shadow: 0 2px 10px rgb(47 111 237 / 0.12); }
  .pill img { width: 22px; height: 22px; border-radius: 6px; }
  h1 { margin: 16px 0 8px; font-size: 40px; font-weight: 800; letter-spacing: -0.02em; }
  h1 em { font-style: normal; color: #2f6fed; }
  .sub { margin: 0; font-size: 18px; color: #5a6478; }
  .win { position: absolute; left: 90px; top: 214px; width: 1100px; height: 640px; border-radius: 14px; overflow: hidden;
    background: #fff; box-shadow: 0 30px 80px rgb(21 33 59 / 0.22), 0 0 0 1px rgb(21 33 59 / 0.06); }
  .bar { height: 46px; display: flex; align-items: center; gap: 14px; padding: 0 16px; background: #eef1f6; border-bottom: 1px solid #dde2ea; }
  .dots { display: flex; gap: 7px; } .dots i { width: 12px; height: 12px; border-radius: 50%; display: block; }
  .url { flex: 1; height: 30px; border-radius: 999px; background: #fff; display: flex; align-items: center; padding: 0 16px;
    font-size: 14px; color: #5a6478; font-family: -apple-system, 'Apple SD Gothic Neo', sans-serif; }
  .url b { color: #15213b; font-weight: 500; }
  .ext { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; }
  .ext.on { background: #dbe5fb; }
  .ext img { width: 18px; height: 18px; }
  .view { position: relative; width: 1100px; height: 594px; overflow: hidden; }
  .view > img { display: block; width: 1100px; }
  .popup { position: absolute; right: 22px; top: 50px; width: 300px; border-radius: 12px; overflow: hidden; background: #fff;
    box-shadow: 0 18px 50px rgb(21 33 59 / 0.28), 0 0 0 1px rgb(21 33 59 / 0.08); }
  .popup img { display: block; width: 300px; }
  .half { position: absolute; inset: 0; }
  .half img { display: block; width: 1100px; }
  .half.right { clip-path: inset(0 0 0 50%); }
  .divider { position: absolute; top: 0; bottom: 0; left: 549px; width: 3px; background: #2f6fed; }
  .knob { position: absolute; top: 270px; left: 528px; width: 44px; height: 44px; border-radius: 50%; background: #2f6fed; color: #fff;
    display: grid; place-items: center; font-size: 18px; font-weight: 700; box-shadow: 0 6px 18px rgb(47 111 237 / 0.4); }
  .tag { position: absolute; top: 84px; font-size: 14px; font-weight: 700; padding: 5px 12px; border-radius: 999px; color: #fff; }
  .tag.l { left: 18px; background: rgb(21 33 59 / 0.78); } .tag.r { right: 18px; background: #2f6fed; }
`;

const windowHtml = ({ url, view, extOn = false }) => `
  <div class="win">
    <div class="bar">
      <div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
      <div class="url">${url}</div>
      <div class="ext ${extOn ? 'on' : ''}"><img src="${icon}"></div>
    </div>
    <div class="view">${view}</div>
  </div>`;

const pageUrl = '<b>tabi-note.example.jp</b>/kyoto/arashiyama-autumn';
const slides = [
  {
    name: '1-translate',
    title: '일본어 웹 페이지를 <em>한국어로</em>',
    sub: '번역은 모두 브라우저 안에서 합니다. 페이지 내용을 외부 서버로 보내지 않습니다.',
    win: windowHtml({ url: pageUrl, extOn: true,
      view: `<img src="${img('translated.png')}"><div class="popup"><img src="${img('popup.png')}"></div>` }),
  },
  {
    name: '2-before-after',
    title: '문장 단위로 <em>자연스럽게</em>',
    sub: '링크나 굵은 글씨로 나뉜 문장도 한 문장으로 번역해 조사와 띄어쓰기를 맞춥니다.',
    win: windowHtml({ url: pageUrl,
      view: `<div class="half"><img src="${img('original.png')}"></div>
             <div class="half right"><img src="${img('translated.png')}"></div>
             <div class="divider"></div><div class="knob">⇆</div>
             <span class="tag l">원문</span><span class="tag r">번역</span>` }),
  },
  {
    name: '3-bilingual',
    title: '원문과 번역문을 <em>함께</em>',
    sub: '팝업의 스위치를 켜면 원문은 그대로 두고 문장마다 번역문을 붙여 보여 줍니다.',
    win: windowHtml({ url: pageUrl, view: `<img src="${img('bilingual-text.png')}">` }),
  },
  {
    name: '4-dictionary',
    title: '사이트별 <em>사용자 사전</em>',
    sub: '고유명사나 자주 틀리는 단어를 사이트마다 정해 두면, 그 사이트를 번역할 때 적용됩니다.',
    win: windowHtml({ url: '<b>hdTrans 일본어 번역</b> · 설정', view: `<img src="${img('options-dict.png')}">` }),
  },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const s of slides) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>
    <div class="head"><span class="pill"><img src="${img('128.png', iconDir)}">hdTrans 일본어 번역</span>
    <h1>${s.title}</h1><p class="sub">${s.sub}</p></div>${s.win}`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: `${out}/${s.name}.png` });
}
await browser.close();

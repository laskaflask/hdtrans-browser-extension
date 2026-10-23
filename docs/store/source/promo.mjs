// Draws the Chrome Web Store small promo tile (440x280).
import { chromium } from 'playwright';
import fs from 'node:fs';

const [iconDir, out] = process.argv.slice(2);
const icon = `data:image/png;base64,${fs.readFileSync(`${iconDir}/128.png`).toString('base64')}`;

const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body { font-family: 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', sans-serif; color: #fff; position: relative;
    background: radial-gradient(420px 300px at 0% 0%, #5b8ff9 0%, transparent 70%),
                radial-gradient(360px 260px at 110% 120%, #1f4fc4 0%, transparent 70%), #2f6fed; }
  .ghost { position: absolute; font-weight: 800; color: rgb(255 255 255 / 0.08); line-height: 1; }
  .ghost.ja { font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif; font-size: 190px; right: 92px; top: -28px; }
  .ghost.ko { font-size: 210px; right: -18px; bottom: -44px; }
  .content { position: absolute; left: 36px; top: 50%; transform: translateY(-50%); }
  img { width: 76px; height: 76px; border-radius: 18px; box-shadow: 0 0 0 3px rgb(255 255 255 / 0.9), 0 12px 28px rgb(10 30 90 / 0.4); }
  h1 { margin: 18px 0 6px; font-size: 32px; font-weight: 800; letter-spacing: -0.02em; }
  p { margin: 0; font-size: 17px; color: rgb(255 255 255 / 0.86); line-height: 1.5; }
</style>
<span class="ghost ja">あ</span><span class="ghost ko">가</span>
<div class="content">
  <img src="${icon}">
  <h1>hdTrans 일본어 번역</h1>
  <p>일본어 웹 페이지를 한국어로,<br>모두 브라우저 안에서</p>
</div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await page.screenshot({ path: `${out}/small-promo-440x280.png` });
await browser.close();

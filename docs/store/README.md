# 스토어 등록 자료

## 스크린샷

`screenshots/`의 1280×800 PNG 4장을 Chrome 웹 스토어와 Firefox 애드온(AMO)에 올립니다.

| 파일 | 내용 |
|---|---|
| `1-translate.png` | 번역한 페이지와 팝업 |
| `2-before-after.png` | 원문과 번역을 반씩 비교 |
| `3-bilingual.png` | 원문과 번역문을 함께 표시 |
| `4-dictionary.png` | 사이트별 사용자 사전 |

예시 페이지 `source/demo.html`(가상의 여행 블로그 `tabi-note.example.jp`)을 실제 확장으로 번역해 찍고,
그 화면을 브라우저 창 모양에 넣어 만듭니다. 화면이 바뀌면 다시 만듭니다.

```sh
npm i --no-save playwright          # Chromium이 없으면 npx playwright install chromium
npm run build
node docs/store/source/capture.mjs .output/chrome-mv3 /tmp/hdtrans-shots
node docs/store/source/compose.mjs /tmp/hdtrans-shots public/icon docs/store/screenshots
```

`capture.mjs`는 빌드를 임시 폴더에 복사해 예시 호스트 접근 권한만 더한 뒤 씁니다(브라우저 자동화로는 `activeTab`을 줄 수
없음). 다른 Chromium을 쓰려면 `CHROMIUM` 환경 변수에 실행 파일 경로를 넣습니다.

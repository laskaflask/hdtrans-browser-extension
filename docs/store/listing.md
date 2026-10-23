# 스토어 설명문

Chrome 웹 스토어와 Firefox 애드온(AMO) 등록 화면에 그대로 붙여 넣는 글입니다. 기능이 바뀌면 같이 고칩니다.
주 언어는 한국어이고, AMO에는 영어 설명도 함께 올립니다.

## 공통

| 항목 | 값 |
|---|---|
| 이름 | hdTrans 일본어 번역 |
| 짧은 설명 (Chrome은 매니페스트 `description`, 132자 이내) | hdTrans WebAssembly 엔진으로 일본어 웹 페이지를 한국어로 번역합니다. 번역은 모두 브라우저 안에서 합니다. |
| 홈페이지 | https://github.com/laskaflask/hdtrans-browser-extension |
| 지원(문의) | https://github.com/laskaflask/hdtrans-browser-extension/issues |
| 개인정보처리방침 | https://github.com/laskaflask/hdtrans-browser-extension/blob/main/docs/privacy.md |
| 라이선스 | GNU AGPL v3.0 이상 (AGPL-3.0-or-later) |
| 스크린샷 | `screenshots/` 4장 (1280×800) |
| 작은 프로모션 타일 (Chrome) | `promo/small-promo-440x280.png` |

## Chrome 웹 스토어

- 카테고리: 도구 (Tools)
- 언어: 한국어

### 상세 설명

```text
일본어 웹 페이지를 한국어로 번역합니다. AI 번역이 아니라 규칙 기반 번역 엔진 hdTrans를 브라우저 안에서 실행하므로, 번역할 페이지 내용을 외부 서버로 보내지 않습니다. 인터넷 연결이 없어도 번역합니다.

■ 사용 방법
• 페이지에서 우클릭 → "페이지 전체 번역"
• 툴바의 hdTrans 아이콘 → "페이지 번역"
• 단축키 Alt+Shift+T (번역 / 원래대로)
• 되돌릴 때는 우클릭 → "원래대로 복원" 또는 팝업의 "원래대로"

■ 기능
• 화면에 보이는 부분부터 번역하고, 번역 중에 스크롤하면 새로 보이는 부분을 먼저 번역합니다.
• 링크나 굵은 글씨로 나뉜 문장도 한 문장으로 번역해 조사와 띄어쓰기를 맞춥니다.
• 원문과 함께 표시: 팝업의 스위치를 켜면 원문은 그대로 두고 문장마다 번역문을 붙여 보여 줍니다. 일본어 공부에도 좋습니다.
• 번역 뒤 새로 나타나는 내용(무한 스크롤, 댓글 등)도 이어서 번역합니다.
• 이미지 설명, 툴팁, 입력 안내문도 번역합니다.
• 사용자 사전: 고유명사나 자주 틀리는 단어를 직접 등록합니다. 모든 사이트, 특정 사이트, 주소 패턴별로 사전을 나눠 둘 수 있고, TSV로 붙여 넣거나 내보낼 수 있습니다.
• 대사(「」) 말투를 기본(내일 간다)과 부드럽게(내일 갈 거야) 중에서 고릅니다.

■ 개인정보
• 번역은 모두 브라우저 안에서 하며, 페이지 내용이나 방문 기록을 어디에도 보내지 않습니다.
• 설정과 사용자 사전은 이 브라우저에만 저장됩니다.
• 모든 사이트 접근 권한을 요구하지 않습니다. 번역을 요청한 탭에서만 동작합니다.

■ 참고
• 처음 번역할 때는 사전을 불러오느라 1초 안팎 더 걸립니다.
• 페이지 본문(메인 프레임)만 번역하며, 다른 사이트에서 불러온 iframe은 번역하지 않습니다.
• 번역 엔진 hdTrans(https://github.com/sokcuri/hdTrans)를 사용한 비공식 확장 프로그램입니다.

소스 코드(AGPL-3.0): https://github.com/laskaflask/hdtrans-browser-extension
```

## Firefox 애드온 (AMO)

- 카테고리: 언어 지원 (Language Support)
- 태그: translation, japanese, korean, translator, offline
- 지원 플랫폼: Firefox (데스크톱), Firefox for Android
- 개인정보처리방침: 위 공통 링크의 내용을 붙여 넣거나 링크합니다.

### 요약 (한국어, 250자 이내)

```text
일본어 웹 페이지를 한국어로 번역합니다. 규칙 기반 번역 엔진 hdTrans를 브라우저 안에서 실행하므로 페이지 내용을 외부로 보내지 않고, 인터넷 연결 없이도 번역합니다. 원문과 함께 표시, 사이트별 사용자 사전을 지원합니다.
```

### 설명 (한국어)

Chrome 상세 설명과 같은 글을 쓰되, 사용 방법을 아래로 바꿉니다(Firefox는 툴바 대신 주소창에 아이콘이 있고, Android에는 우클릭 메뉴와 단축키가 없음).

```text
■ 사용 방법
• 페이지에서 우클릭 → "페이지 전체 번역"
• 주소창의 hdTrans 아이콘 → "페이지 번역"
• 단축키 Alt+Shift+T (번역 / 원래대로)
• Firefox for Android: 메뉴 → 확장 기능 → hdTrans 일본어 번역 → "페이지 번역"
```

### Summary (English)

```text
Translates Japanese web pages into Korean with the rule-based hdTrans engine running in your browser: page content never leaves your device, and it works offline. Can show the original alongside. Per-site user dictionaries.
```

### Description (English)

```text
Translates Japanese web pages into Korean. Instead of an online AI service, it runs the rule-based translation engine hdTrans (WebAssembly) inside your browser: the text of the page is never sent anywhere, and translation works without an internet connection.

How to use
• Right-click the page → "페이지 전체 번역" (translate page)
• Click the hdTrans icon in the address bar → "페이지 번역"
• Keyboard shortcut Alt+Shift+T (translate / restore)
• Firefox for Android: Menu → Extensions → hdTrans 일본어 번역

Features
• Translates what is on screen first; when you scroll during translation, the newly visible part goes next.
• Sentences split by links or bold text are translated as one sentence, so particles and spacing come out right.
• Show the original alongside: keep the Japanese text and show each sentence's translation after it.
• Keeps translating content that appears later (infinite scroll, comments).
• Also translates image descriptions, tooltips and input placeholders.
• User dictionaries for names and terms, for all sites or for specific sites and URL patterns, with TSV import and export.

Privacy
• All translation happens in the browser. No page content, browsing history or other data is collected or transmitted.
• Settings and dictionaries are stored only in this browser.
• No access to all websites is requested; the extension acts only on the tab you ask it to translate.

The interface is in Korean. This is an unofficial extension built on hdTrans (https://github.com/sokcuri/hdTrans).
Source code (AGPL-3.0): https://github.com/laskaflask/hdtrans-browser-extension
```

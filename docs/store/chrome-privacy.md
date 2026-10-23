# Chrome 웹 스토어 개인정보 탭

Chrome 웹 스토어 개발자 대시보드의 "개인정보 보호" 탭에 넣는 답변입니다. 대시보드는 영어 답변을 권하므로 입력할 글은
영어로 두고, 한국어 설명을 함께 적습니다. 권한이나 데이터 처리가 바뀌면 같이 고칩니다.

## 단일 목적 (Single purpose)

한 가지 좁은 목적을 설명하는 칸입니다.

```text
Translates the Japanese text of the web page the user asks to translate into Korean, locally in the browser, and puts the page back on request.
```

## 권한 사용 이유 (Permission justification)

매니페스트의 권한마다 한 칸씩 있습니다. Chrome 빌드의 권한은 `activeTab`, `scripting`, `contextMenus`, `storage`,
`offscreen`이며 호스트 권한은 없습니다.

**activeTab**

```text
Gives temporary access to the current tab only when the user starts a translation (context menu, toolbar popup or keyboard shortcut), so the extension can read and replace that page's Japanese text. No host permissions are requested.
```

**scripting**

```text
Injects the extension's own translation script (content-scripts/translator.js, packaged in the extension) into the tab the user asked to translate, using the access granted by activeTab. The script is not injected into any other page.
```

**contextMenus**

```text
Adds two items to the page context menu: "translate the whole page" and "restore the original".
```

**storage**

```text
Saves the user's settings (speech style, which parts to translate, display mode) and the user dictionaries they create, in chrome.storage.local on this device.
```

**offscreen**

```text
Runs the bundled hdTrans translation engine (WebAssembly) and keeps its dictionary loaded in an offscreen document, because the service worker cannot host it. The offscreen document only translates text passed from the extension; it loads nothing from the network.
```

## 원격 코드 (Remote code)

- 선택: **No, I am not using remote code.**
- 엔진(WebAssembly), 런타임, 사전이 모두 확장 패키지 안에 있고, 외부에서 스크립트를 불러오거나 `eval`을 쓰지 않습니다.

## 데이터 사용 (Data usage)

**수집하는 데이터 항목: 하나도 체크하지 않습니다.**

이 확장은 사용자가 번역을 요청한 페이지의 글자를 읽어 번역하지만, 그 처리는 모두 브라우저 안에서 끝나고 어떤 데이터도
기기 밖으로 보내지 않으며 개발자가 받지도 않습니다. 저장하는 것은 사용자가 직접 정한 설정과 사용자 사전뿐이며 이 기기의
`chrome.storage.local`에만 있습니다. 그래서 "개인 식별 정보", "웹 기록", "웹사이트 콘텐츠" 등 어느 항목에도 해당하지
않는 것으로 봅니다.

> 심사에서 페이지 글자를 읽는 것을 "웹사이트 콘텐츠" 처리로 보고 공개를 요구하면, "웹사이트 콘텐츠"만 체크하고 용도를
> "기기 안에서 번역하는 데만 쓰며 전송하지 않음"으로 적습니다. 이 경우에도 아래 인증 세 가지는 그대로 체크할 수 있습니다.

**인증 (세 가지 모두 체크)**

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## 개인정보처리방침 URL

```text
https://github.com/laskaflask/hdtrans-browser-extension/blob/main/docs/privacy.md
```

수집하는 데이터가 없으면 필수 칸은 아니지만, 심사와 사용자 안내를 위해 넣습니다. 이 주소는 저장소를 푸시한 뒤에 열립니다.

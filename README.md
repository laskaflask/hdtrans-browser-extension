# hdTrans 브라우저 확장

일본어 웹 페이지를 한국어로 번역하는 브라우저 확장 기능입니다. AI 번역이 아니라
[hdTrans](https://github.com/sokcuri/hdTrans) 규칙 기반 번역 엔진(WebAssembly)을 브라우저 안에서 실행하며,
번역할 텍스트를 외부 서버로 보내지 않습니다.

## 지원 브라우저

> **이 프로젝트는 Chrome과 Firefox를 반드시 함께 지원해야 합니다.**
> 한쪽 브라우저에서만 동작하는 기능이나 API는 들이지 않으며, 변경은 두 브라우저에서 모두 빌드하고 확인한 뒤 반영합니다.

| 브라우저 | 매니페스트 | 엔진을 띄우는 곳 |
|---|---|---|
| Chrome | MV3 | 오프스크린 문서 (서비스 워커에는 DOM이 없고 쉬면 종료되므로) |
| Firefox 142 이상 (데스크톱·Android) | MV3 | 백그라운드 페이지 (이벤트 페이지라 쉬면 내려가고, 다음 번역 때 엔진을 다시 읽음) |

Firefox for Android에는 우클릭 메뉴와 단축키가 없으므로 메뉴의 확장 기능 항목(팝업)으로 번역합니다.

## 기능

- **페이지 전체 번역**: 페이지에서 우클릭 → `페이지 전체 번역`. 툴바 팝업이나 `Alt+Shift+T`로도 됩니다.
  - 화면에 보이는 부분부터 번역합니다. 번역 중에 스크롤하면 새로 보이는 부분을 먼저 번역합니다.
  - **원문과 함께 표시**: 툴바 팝업의 스위치(또는 설정)를 켜면 원문을 그대로 두고 문장마다 번역문을 아래에
    붙입니다. 메뉴나 제목처럼 짧은 글은 같은 줄에 붙입니다. 번역된 페이지에서 바꾸면 바로 다시 그립니다.
  - 번역을 기다리는 문장은 번역될 때까지 깜빡입니다(설정에서 끌 수 있음, 동작 줄이기 설정에서는 흐리게만 표시).
  - 번역 뒤 새로 나타나는 내용도 이어서 번역합니다(설정에서 끌 수 있음).
  - `<b>`, `<a>` 등으로 나뉜 문장은 한 문장으로 번역해 조사와 띄어쓰기를 맞춥니다.
  - `alt`, `title`, `placeholder`, `aria-label` 속성도 번역합니다(설정에서 끌 수 있음).
  - `<code>`, 입력란, 편집 가능한 영역, `translate="no"`, `.notranslate`는 건드리지 않습니다.
- **원래대로 복원**: 우클릭 → `원래대로 복원`. 번역 뒤 페이지가 스스로 바꾼 텍스트는 그대로 둡니다.
- **사용자 사전**: 설정 페이지에서 사전을 만들고 적용 범위를 정합니다.
  - 범위: 모든 사이트 / 사이트(도메인, 하위 도메인 포함) / 주소 시작 / 주소 패턴(`*`) / 정규식
  - 항목은 hdTrans 사용자 사전 형식(일본어, 한국어, 품사, 옵션)이며 TSV로 붙여 넣거나 내보낼 수 있습니다.
  - 한 페이지에 여러 사전이 맞으면 ‘모든 사이트’ 사전을 먼저, 나머지를 목록 순서대로 합칩니다. 같은 단어는 뒤 사전이 우선합니다.
  - 저장할 때 엔진이 각 사전을 읽어 보고, 읽지 못한 행(잘못된 품사 등)을 알려 줍니다.

## 개발

Node.js 22 이상.

```sh
npm install
npm run dev            # Chrome을 띄워 확장을 불러옴 (WXT)
npm run dev:firefox    # Firefox로
npm run build:all      # .output/chrome-mv3, .output/firefox-mv3
npm run zip            # Chrome 배포 파일
npm run zip:firefox    # Firefox 배포 파일과 AMO 제출용 소스 묶음
npm test               # 사전 매칭, 텍스트 분할, 배포할 엔진으로 번역하는 테스트
npm run test:e2e       # 빌드한 확장을 실제 Chrome·Firefox에 띄워 번역하는 테스트
npm run compile        # 타입 검사
```

`HDTRANS_E2E=1`로 빌드하면 매니페스트에 `http://localhost/*` 접근 권한이 붙습니다. 브라우저 자동화는 `activeTab`을
줄 수 없으므로 종단 간 테스트용으로만 씁니다.

### 종단 간(E2E) 테스트

`npm run test:e2e`는 두 브라우저를 모두 빌드한 뒤 `tests/e2e/run.mjs`로 각 빌드를 실제 브라우저에 설치하고,
`tests/e2e/page.html`을 번역합니다. 인라인 요소·루비·글자마다 나뉜 문장, 속성, 잘못된 행이 섞인 사용자 사전,
원래대로 복원, 설정 페이지의 사전 저장 경고를 확인하고, 페이지와 확장 페이지에 오류가 없어야 통과합니다.
브라우저는 [puppeteer-core](https://pptr.dev/)로 다룹니다(Chrome은 CDP, Firefox는 WebDriver BiDi).

- 브라우저는 따로 설치합니다. Chrome 정식판은 `--load-extension`을 막으므로 Chromium을 씁니다(Playwright가 설치한
  Chromium도 찾음). Firefox는 Mozilla 배포판을 쓰며, Linux에서는 `scripts/install-firefox.sh`로 설치할 수 있습니다
  (`FIREFOX_VERSION=142.0`처럼 버전 지정 가능).
- 실행 파일 경로는 `CHROMIUM`, `FIREFOX` 환경 변수로 정할 수 있습니다. 한 브라우저만 돌리려면
  `node tests/e2e/run.mjs firefox`, 번역된 화면을 저장하려면 `E2E_OUT=폴더`를 줍니다.
- 테스트는 빌드를 임시 폴더에 복사해 테스트 호스트 접근 권한을 더한 뒤 씁니다. Firefox 사본에서는 팝업과 설정 페이지를
  테스트 호스트에서만 열 수 있게 합니다(자동화로는 `moz-extension://` 페이지로 바로 이동할 수 없음).
- 번역문 기대값은 엔진 버전에 따라 바뀔 수 있으므로, 엔진을 올릴 때 함께 확인합니다.

Claude Code 클라우드 세션에서는 Chromium이 미리 설치되어 있으므로, 환경의 설정 스크립트(Setup script)에 Firefox
설치만 넣으면 됩니다. 네트워크 접근에서 `download.mozilla.org`와 `download-installer.cdn.mozilla.net`을 허용해야 합니다.

아이콘 원본은 `assets/icon.svg`이고, 이를 16·32·48·96·128px로 내보낸 PNG를 `public/icon/`에 둡니다(WXT가 매니페스트에
넣음). 원본을 고치면 PNG도 다시 내보냅니다.

### 엔진

npm 패키지 [`hdtrans`](https://www.npmjs.com/package/hdtrans)의 엔진은 Emscripten 기본값으로 링크되어 embind 코드가
실행 중에 `new Function`으로 함수를 만듭니다. Chrome과 Firefox 모두 확장 페이지에서 이를 금지하므로, 같은 버전의
hdTrans 소스를 `-sDYNAMIC_EXECUTION=0`으로 다시 빌드한 엔진을 `vendor/hdtrans/`에 커밋해 둡니다.

| 파일 | 출처 |
|---|---|
| `hdtrans_engine.js`, `hdtrans_engine.wasm` | `vendor/hdtrans/` (`npm run build:engine`으로 빌드) |
| `runtime.js`, `dicts.hdsnap`(약 37MB), `dicts.txt` | npm `hdtrans` 패키지 |

사전 스냅숏은 같은 소스로 빌드한 엔진에서만 열리므로, `hdtrans` 버전을 올리면 엔진도 다시 빌드합니다.
엔진은 hdTrans CI와 같은 Emscripten 4.0.22로만 빌드하며(스크립트가 버전을 확인), 같은 버전이면 몇 번을 빌드해도
같은 파일이 나옵니다. 빌드 정보는 `vendor/hdtrans/BUILD.txt`에 남습니다.

```sh
brew install cmake ninja
git clone https://github.com/emscripten-core/emsdk.git && emsdk/emsdk install 4.0.22 && emsdk/emsdk activate 4.0.22
source emsdk/emsdk_env.sh
npm install hdtrans@<버전>
npm run build:engine     # GitHub의 v<버전> 태그를 빌드. 로컬 클론은 HDTRANS_SRC=경로
npm test                 # 엔진에 동적 코드가 없는지, 패키지와 버전이 같은지 확인
```

### Firefox 애드온(AMO) 제출용 소스

AMO는 번들·압축한 코드의 원본과, 검토자가 같은 결과물을 다시 만들 수 있는 빌드 방법을 요구합니다.
`npm run zip:firefox`가 만드는 `.output/hdtrans-browser-extension-<버전>-sources.zip`을 소스로 올립니다.

- 환경: Node.js 22 이상, npm 11. 운영체제는 상관없습니다. macOS(Node 23)와 Node 24.22·npm 11.21에서 빌드한
  결과물이 바이트 단위로 같음을 확인했습니다.
- 빌드: 소스 압축을 푼 폴더에서 아래를 실행하면 `.output/firefox-mv3/`가 제출한 확장과 같게 나옵니다.

  ```sh
  npm ci
  npm run build:firefox
  ```

- 미리 빌드된 파일: `vendor/hdtrans/hdtrans_engine.js`, `hdtrans_engine.wasm`은 hdTrans(MPL-2.0) v<버전> 태그를
  위 [엔진](#엔진) 절차(`scripts/build-engine.sh`, Emscripten 4.0.22)로 빌드한 것이며, 같은 절차로 다시 만들 수
  있습니다. `runtime.js`와 사전(`dicts.hdsnap`, `dicts.txt`)은 npm `hdtrans` 패키지 파일을 고치지 않고 그대로
  복사합니다(`package-lock.json`에 버전과 무결성 값이 있음).
- 제출할 때 검토자 메모 칸에는 [docs/amo-reviewer-notes.md](docs/amo-reviewer-notes.md)의 영어 본문을 붙여 넣습니다.

## 구조

```
우클릭 메뉴/팝업/단축키
  → background (서비스 워커)       메뉴, 콘텐츠 스크립트 주입, 페이지 주소에 맞는 사전 합치기
  → translator.content (페이지)    텍스트 수집·문장 단위 묶기·적용·복원·변경 감시
  → 엔진 (lib/engine.ts)            Chrome: offscreen 문서 / Firefox: background 페이지
```

- 콘텐츠 스크립트는 상시 주입하지 않고 번역을 요청할 때 `activeTab` 권한으로 주입합니다. 모든 사이트 접근 권한이 필요 없습니다.
- 팝업의 "이 사이트는 항상 자동 번역"을 켜면 그 사이트의 호스트 권한을 선택 권한(`optional_host_permissions`)으로 요청합니다.
  허용하면 사이트 키(`lib/sites.ts`)를 `storage.local`에 저장하고, 이후 그 사이트의 페이지 로드가 끝날 때마다 background가
  주입하고 번역합니다. 권한 요청은 사용자의 클릭에서 바로(`await` 앞에서) 해야 하므로 팝업에서만 합니다.
- 인라인 요소로 나뉜 문장은 노드 사이에 `∥`(U+2225)를 넣은 줄과 넣지 않은 줄을 함께 번역해, 앞의 결과로 노드를 나누고
  뒤의 결과에서 띄어쓰기를 가져옵니다(`lib/text.ts`). 나눌 수 없으면 노드별로 다시 번역합니다.

| 파일 | 내용 |
|---|---|
| `lib/sites.ts` | 사이트 키, 호스트 권한 패턴, 자동 번역 사이트 매칭 |
| `entrypoints/background.ts` | 메뉴, 단축키, 배지, 자동 번역, 번역 요청 중계. Firefox에서는 엔진도 직접 띄움 |
| `entrypoints/translator.content.ts` | 페이지 번역과 복원 |
| `entrypoints/offscreen/` | Chrome 전용. 엔진을 띄워 두는 문서 |
| `lib/engine.ts` | 엔진 불러오기와 번역·사전 확인 요청 처리 |
| `scripts/build-engine.sh` | 동적 코드 없는 엔진 빌드 |
| `entrypoints/popup/`, `entrypoints/options/` | 팝업, 설정과 사전 편집 |
| `lib/dictionary.ts` | 사전 규칙, 주소 매칭, TSV 변환 |
| `lib/text.ts` | 엔진 입력 줄 만들기와 결과 되돌리기 |

## 제한

- Firefox의 백그라운드 페이지는 한동안 쓰지 않으면 내려가므로, 그 뒤 첫 번역은 엔진을 다시 읽는 만큼 늦습니다.
- 메인 프레임만 번역합니다(다른 출처의 iframe은 제외).
- 엔진이 처음 뜰 때 사전을 메모리에 올리므로 첫 번역은 1초 안팎 더 걸리고, 엔진과 사전이 오프스크린 문서에 계속 상주합니다(메모리 사용량은 아직 측정하지 않음).

## 라이선스

이 확장은 hdTrans와 같은 MPL-2.0(Mozilla Public License 2.0)으로 배포합니다. 자세한 내용은 [LICENSE](LICENSE) 파일을
참고하세요. 0.1.0까지의 버전은 당시 hdTrans(0.5.x)를 따라 AGPL-3.0-or-later로 배포했습니다.

빌드 결과물에는 `LICENSE.txt`, 이 확장에 포함된 제3자 소프트웨어 고지([THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)),
hdTrans 패키지의 고지(`hdtrans/NOTICE`, `hdtrans/THIRD-PARTY-NOTICES.txt`)가 함께 들어가고, 설정 페이지 아래에 라이선스와 소스 저장소 링크가
있습니다. 번들에 들어가는 npm 패키지가 바뀌면 `THIRD-PARTY-NOTICES.txt`도 고칩니다.

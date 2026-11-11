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

- **페이지 전체 번역**: 페이지에서 우클릭 → `hdTrans로 번역하기`. 툴바 팝업이나 `Alt+Shift+T`로도 됩니다.
  - 화면에 보이는 부분부터 번역합니다. 번역 중에 스크롤하면 새로 보이는 부분을 먼저 번역합니다.
  - **원문과 함께 표시**: 툴바 팝업의 스위치(또는 설정)를 켜면 원문을 그대로 두고 문장마다 번역문을 아래에
    붙입니다. 메뉴나 제목처럼 짧은 글은 같은 줄에 붙입니다. 번역된 페이지에서 바꾸면 바로 다시 그립니다.
  - 번역을 기다리는 문장은 번역될 때까지 깜빡입니다(설정에서 끌 수 있음, 동작 줄이기 설정에서는 흐리게만 표시).
  - 번역 뒤 새로 나타나는 내용도 이어서 번역합니다(설정에서 끌 수 있음).
  - `<b>`, `<a>` 등으로 나뉜 문장은 한 문장으로 번역해 조사와 띄어쓰기를 맞춥니다.
  - `alt`, `title`, `placeholder`, `aria-label` 속성도 번역합니다(설정에서 끌 수 있음).
  - `<code>`, 입력란, 편집 가능한 영역, `translate="no"`, `.notranslate`는 건드리지 않습니다.
  - 같은 출처 iframe은 함께 번역하고, 다른 출처 iframe은 그 출처의 접근 권한을 허용했을 때만 번역합니다.
    `translate="no"`가 붙은 iframe은 권한이 있어도 건드리지 않습니다.
- **원래대로 복원**: 번역된 페이지에서 우클릭 → `hdTrans 원문으로 되돌리기`. 우클릭 메뉴에는 페이지 상태에 따라 번역/되돌리기 한 항목만 있고, 권한이 없는 임베드가 있으면 제목에 `· 임베드 N개 권한 필요`가 붙습니다. 그 출처의 허용은 팝업의 `임베드 번역 허용`에서 하며, 번역 직후 페이지 오른쪽 아래에도 같은 안내가 뜹니다. 번역 뒤 페이지가 스스로 바꾼 텍스트는 그대로 둡니다.
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

`npm run test:e2e`는 두 브라우저용으로 빌드한 뒤 `tests/e2e/run.mjs`로 각 빌드를 실제 브라우저에 설치하고,
`tests/e2e/page.html`을 번역합니다. 인라인 요소·루비·글자마다 나뉜 문장, 속성, 잘못된 행이 섞인 사용자 사전,
원래대로 복원, 설정 페이지의 사전 저장 경고를 확인하고, 페이지와 확장 페이지에 오류가 없어야 통과합니다.
다른 출처 iframe은 그 출처의 권한이 있을 때 번역되고 없을 때 원문으로 남는지, `translate="no"` iframe은 권한이
있어도 번역하지 않는지를 브라우저마다 두 번(권한 있음·없음) 확인합니다.
브라우저는 [puppeteer-core](https://pptr.dev/)로 다룹니다(Chrome은 CDP, Firefox는 WebDriver BiDi).

- 브라우저는 따로 설치합니다. Chrome(또는 Chromium)과 Mozilla Firefox를 PATH와 macOS의 `/Applications`에서 찾으며,
  `CHROMIUM`, `FIREFOX` 환경 변수로 실행 파일 경로를 정할 수도 있습니다.
- 한 브라우저만 돌리려면 `node tests/e2e/run.mjs firefox`, 번역된 화면을 저장하려면 `E2E_OUT=폴더`를 줍니다.
- 테스트는 임시 프로필로 브라우저를 띄우고, 빌드를 임시 폴더에 복사해 테스트 호스트(`e2e.example.jp`)와 임베드
  호스트(`embed.example.jp`, 둘 다 로컬 서버로 연결됨) 접근 권한만 더해 씁니다. 권한 없음 시나리오에서는 임베드
  호스트를 뺍니다. 외부로 나가는 통신은 없고, 배포 빌드는 바뀌지 않습니다.
  Firefox 사본에서는 팝업과 설정 페이지를 테스트 호스트에서만 열 수 있게 합니다(자동화로는 `moz-extension://`
  페이지로 바로 이동할 수 없음).
- `build:all`이 `.output/chrome-mv3`, `.output/firefox-mv3`를 다시 만듭니다. 스토어에 낼 파일은 테스트 뒤에
  다시 빌드합니다.
- 번역문 기대값은 엔진 버전에 따라 바뀔 수 있으므로, 엔진을 올릴 때 함께 확인합니다.

아이콘 원본은 `assets/icon.svg`이고, 이를 16·32·48·96·128px로 내보낸 PNG를 `public/icon/`에 둡니다(WXT가 매니페스트에
넣음). 원본을 고치면 PNG도 다시 내보냅니다.

### 엔진

npm 패키지 [`hdtrans`](https://www.npmjs.com/package/hdtrans)의 엔진은 Emscripten 기본값으로 링크되어 embind 코드가
실행 중에 `new Function`으로 함수를 만듭니다. Chrome과 Firefox 모두 확장 페이지에서 이를 금지하므로, 같은 버전의
hdTrans 소스를 `-sDYNAMIC_EXECUTION=0`으로 다시 빌드한 엔진을 `vendor/hdtrans/`에 커밋해 둡니다.

| 파일 | 출처 |
|---|---|
| `hdtrans_engine.js`, `hdtrans_engine.wasm` | `vendor/hdtrans/` (`npm run build:engine`으로 빌드) |
| `runtime.js`, `dicts.hdsnap`(약 36MB), `dicts.txt` | npm `hdtrans` 패키지 |

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

- 환경: Node.js 22 이상, npm 11. 운영체제는 상관없습니다. macOS(Node 23)와 Node 24.22·npm 11.21, 그리고
  Node 22.23·24.18(npm 11.16)에서 빌드한 결과물이 바이트 단위로 같음을 확인했습니다.
- 빌드: 소스 압축을 푼 폴더에서 아래를 실행하면 `.output/firefox-mv3/`가 제출한 확장과 같게 나옵니다.

  ```sh
  npm ci
  npm run build:firefox
  ```

- 미리 빌드된 파일: `vendor/hdtrans/hdtrans_engine.js`, `hdtrans_engine.wasm`은 hdTrans(0.9.0부터 AGPL-3.0-only) v<버전> 태그를
  위 [엔진](#엔진) 절차(`scripts/build-engine.sh`, Emscripten 4.0.22)로 빌드한 것이며, 같은 절차로 다시 만들 수
  있습니다. `runtime.js`와 사전(`dicts.hdsnap`, `dicts.txt`)은 npm `hdtrans` 패키지 파일을 고치지 않고 그대로
  복사합니다(`package-lock.json`에 버전과 무결성 값이 있음).
- 제출할 때 검토자 메모 칸에는 [docs/amo-reviewer-notes.md](docs/amo-reviewer-notes.md)의 영어 본문을 붙여 넣습니다.

## 스토어 배포본 확인

[Chrome 웹 스토어](https://chromewebstore.google.com/detail/bcdkkloifhaoahiekaahepkmkhfaafcd)와
[Firefox 애드온(AMO)](https://addons.mozilla.org/firefox/addon/hdtrans-ja-ko@hdtrans-browser-extension/)가 배포하는 패키지가
이 저장소의 소스로 만든 것인지 누구나 확인할 수 있습니다. 빌드가 재현되므로(같은 소스면 바이트 단위로 같은 결과물),
스토어 패키지를 받아 같은 버전의 Git 태그(`v<버전>`)를 빌드한 결과와 비교하면 됩니다.

스토어는 받은 파일을 그대로 배포하되, 서명을 덧붙이고 `manifest.json`만 고칩니다.

| 스토어 | 덧붙이는 서명 | `manifest.json` |
|---|---|---|
| Chrome 웹 스토어 | `_metadata/verified_contents.json`(파일별 해시, 개발자와 웹 스토어가 서명) | `"update_url": "https://clients2.google.com/service/update2/crx"`를 더함 |
| AMO | `META-INF/`(`mozilla.rsa`, `cose.sig` 등 Mozilla 서명) | 들여쓰기하고 한글을 `\uXXXX`로 바꿔 다시 씀(값은 같음) |

그래서 서명 폴더는 빼고, `manifest.json`은 JSON 값으로(Chrome은 `update_url`을 빼고) 비교하며, 나머지 파일은 바이트
단위로 비교합니다. 2026-11-02에 확인한 결과, 아래 버전은 모두 이 차이 말고는 태그를 빌드한 결과와 같았습니다.

| 스토어 | 버전 | 비교한 파일 |
|---|---|---|
| AMO | 0.4.0, 0.3.0 | 25개(`manifest.json` 포함) |
| Chrome 웹 스토어 | 0.3.0 | 28개(`manifest.json` 포함) |

`scripts/verify-store.mjs`가 이 비교를 합니다. 스토어에서 현재 버전을 받고, 같은 버전의 태그를 임시 폴더에 풀어
`npm ci`로 빌드한 뒤 파일을 하나씩 비교합니다. 같으면 0, 다르면 다른 파일을 나열하고 1로 끝납니다.

```sh
git fetch --tags
npm run verify:store -- firefox                    # AMO의 현재 버전
npm run verify:store -- firefox --version 0.3.0    # AMO의 지난 버전
npm run verify:store -- chrome                     # Chrome 웹 스토어의 현재 버전
npm run verify:store -- chrome --build .output/chrome-mv3   # 태그 대신 이미 빌드한 폴더와 비교
```

- 빌드 환경은 [AMO 제출용 소스](#firefox-애드온amo-제출용-소스)와 같습니다(Node.js 22 이상, npm 11).
- Chrome 웹 스토어는 현재 버전만 내려받을 수 있습니다. 심사 중인 버전은 승인된 뒤에 확인할 수 있습니다.
- Chrome 빌드는 AMO 제출용 소스 zip이 아니라 Git 태그로 만들어야 합니다. 소스 zip에는 Chrome 전용인
  `entrypoints/offscreen/`이 빠져 있기 때문입니다.
- 확인하는 대상은 스토어가 지금 배포하는 패키지입니다. 브라우저에 이미 설치된 파일을 직접 검사하지는 않습니다.

## 구조

```
우클릭 메뉴/팝업/단축키
  → background (서비스 워커)       메뉴, 콘텐츠 스크립트 주입, 페이지 주소에 맞는 사전 합치기
  → translator.content (페이지)    텍스트 수집·문장 단위 묶기·적용·복원·변경 감시
  → 엔진 (lib/engine.ts)            Chrome: offscreen 문서 / Firefox: background 페이지
```

- 콘텐츠 스크립트는 상시 주입하지 않고 번역을 요청할 때 `activeTab` 권한으로 주입합니다(최소 권한 원칙). 모든 사이트 접근 권한이 필요 없습니다.
  번역 후 페이지에 뜨는 임베드 안내도 이 스크립트가 그리는 것이라 추가 권한이 필요하지 않습니다.
- 다른 출처 iframe은 페이지가 먼저 iframe 주소를 모아 background에 넘기고, background는 접근 가능한 프레임에만 주입합니다.
  권한이 없는 출처는 팝업에서 그 출처(`https://host/*`)만 선택 권한으로 요청하며, 허용한 출처는 설정 페이지에서 취소할 수 있습니다.
- 팝업의 "이 사이트는 항상 자동 번역"을 켜면 그 사이트의 호스트 권한을 선택 권한(`optional_host_permissions`)으로 요청합니다.
  허용하면 사이트 키(`lib/sites.ts`)를 `storage.local`에 저장하고, 이후 그 사이트의 페이지 로드가 끝날 때마다 background가
  주입하고 번역합니다. 권한 요청은 사용자의 클릭에서 바로(`await` 앞에서) 해야 하므로 팝업에서만 합니다.
  켠 사이트는 설정 페이지의 "사이트 접근 권한"에 나열되고 거기서 끌 수 있습니다.
- 설정의 "사이트 접근 권한" 하단에서 "모든 페이지 접근 허용"을 누르면 예외적으로 모든 http(s) 사이트 접근 권한을 한 번에 선택 권한으로 허용할 수 있습니다.
  허용하면 임베드 출처별 요청이 필요 없고 사이트별 자동 번역을 켤 때도 권한을 묻지 않지만, 자동 번역은 여전히 사이트별로
  켭니다. 이 권한도 설정에서 언제든 취소할 수 있습니다.
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
- 다른 출처의 iframe(예: 임베드된 게시물)은 그 출처의 접근 권한을 따로 허용했을 때 함께 번역합니다. 페이지의 사이트 접근 권한이나
  `activeTab`만으로는 제3자 프레임을 읽을 수 없고, iframe 주소가 같은 출처에서 다른 출처로 넘어가는 경우에는 미리 알 수 없습니다.
- 엔진이 처음 뜰 때 사전을 메모리에 올리므로 첫 번역은 1초 안팎 더 걸리고, 엔진과 사전이 오프스크린 문서에 계속 상주합니다(메모리 사용량은 아직 측정하지 않음).

## 라이선스

이 확장은 AGPL-3.0-or-later(GNU Affero General Public License 3 이상)로 배포합니다. 자세한 내용은 [LICENSE](LICENSE) 파일을
참고하세요. 번들하는 hdTrans 엔진·사전이 0.9.0부터 AGPL-3.0-only이므로, 이에 맞춰 0.5.0부터 AGPL로 되돌렸습니다.
0.1.0까지는 AGPL-3.0-or-later, 0.2.0~0.4.x는 MPL-2.0으로 배포했고 이미 배포한 버전의 라이선스는 그대로입니다.

빌드 결과물에는 `LICENSE.txt`, 이 확장에 포함된 제3자 소프트웨어 고지([THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)),
hdTrans 패키지의 고지(`hdtrans/NOTICE`, `hdtrans/THIRD-PARTY-NOTICES.txt`)가 함께 들어가고, 설정 페이지 아래에 라이선스와 소스 저장소 링크가
있습니다. 번들에 들어가는 npm 패키지가 바뀌면 `THIRD-PARTY-NOTICES.txt`도 고칩니다.

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
| Firefox 128 이상 | MV3 | 백그라운드 페이지 (이벤트 페이지라 쉬면 내려가고, 다음 번역 때 엔진을 다시 읽음) |

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
npm run compile        # 타입 검사
```

`HDTRANS_E2E=1`로 빌드하면 매니페스트에 `http://localhost/*` 접근 권한이 붙습니다. 브라우저 자동화는 `activeTab`을
줄 수 없으므로 종단 간 테스트용으로만 씁니다.

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

```sh
brew install emscripten ninja
npm install hdtrans@<버전>
npm run build:engine     # GitHub의 v<버전> 태그를 빌드. 로컬 클론은 HDTRANS_SRC=경로
npm test                 # 엔진에 동적 코드가 없는지, 패키지와 버전이 같은지 확인
```

## 구조

```
우클릭 메뉴/팝업/단축키
  → background (서비스 워커)       메뉴, 콘텐츠 스크립트 주입, 페이지 주소에 맞는 사전 합치기
  → translator.content (페이지)    텍스트 수집·문장 단위 묶기·적용·복원·변경 감시
  → 엔진 (lib/engine.ts)            Chrome: offscreen 문서 / Firefox: background 페이지
```

- 콘텐츠 스크립트는 상시 주입하지 않고 번역을 요청할 때 `activeTab` 권한으로 주입합니다. 모든 사이트 접근 권한이 필요 없습니다.
- 인라인 요소로 나뉜 문장은 노드 사이에 `‖`를 넣은 줄과 넣지 않은 줄을 함께 번역해, 앞의 결과로 노드를 나누고
  뒤의 결과에서 띄어쓰기를 가져옵니다(`lib/text.ts`). 나눌 수 없으면 노드별로 다시 번역합니다.

| 파일 | 내용 |
|---|---|
| `entrypoints/background.ts` | 메뉴, 단축키, 배지, 번역 요청 중계. Firefox에서는 엔진도 직접 띄움 |
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

hdTrans가 AGPL-3.0-or-later이므로 이 확장도 같은 라이선스를 따릅니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참고하세요.

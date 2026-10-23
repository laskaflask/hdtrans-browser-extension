# hdTrans 브라우저 확장

일본어 웹 페이지를 한국어로 번역하는 Chrome 확장 기능입니다. AI 번역이 아니라
[hdTrans](https://github.com/sokcuri/hdTrans) 규칙 기반 번역 엔진(WebAssembly)을 브라우저 안에서 실행하며,
번역할 텍스트를 외부 서버로 보내지 않습니다.

## 기능

- **페이지 전체 번역**: 페이지에서 우클릭 → `페이지 전체 번역`. 툴바 팝업이나 `Alt+Shift+T`로도 됩니다.
  - 화면에 보이는 부분부터 번역하고, 번역 뒤 새로 나타나는 내용도 이어서 번역합니다(설정에서 끌 수 있음).
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
npm run dev      # Chrome을 띄워 확장을 불러옴 (WXT)
npm run build    # .output/chrome-mv3
npm run zip
npm test         # 사전 매칭, 텍스트 분할, 실제 엔진을 쓰는 번역 단위 테스트
npm run compile  # 타입 검사
```

엔진, wasm, 기본 사전(`dicts.hdsnap`, 약 37MB)은 npm 패키지 [`hdtrans`](https://www.npmjs.com/package/hdtrans)에서
빌드할 때 `hdtrans/`로 복사합니다(`wxt.config.ts`). 엔진을 바꾸려면 `package.json`의 `hdtrans` 버전을 올립니다.

## 구조

```
우클릭 메뉴/팝업/단축키
  → background (서비스 워커)       메뉴, 콘텐츠 스크립트 주입, 페이지 주소에 맞는 사전 합치기
  → translator.content (페이지)    텍스트 수집·문장 단위 묶기·적용·복원·변경 감시
  → offscreen 문서                 엔진을 계속 띄워 둠 (서비스 워커는 쉬면 종료되므로)
  → engine.sandbox (iframe)        hdTrans WASM 실행
```

- 엔진의 embind 코드가 `new Function`을 쓰는데, MV3 확장 페이지 CSP는 이를 막습니다. 그래서 엔진은 eval이
  허용되는 샌드박스 페이지에서 돌고, 샌드박스는 확장 파일을 직접 읽지 못하므로 오프스크린 문서가 wasm과 사전을
  읽어 넘겨 줍니다.
- 콘텐츠 스크립트는 상시 주입하지 않고 번역을 요청할 때 `activeTab` 권한으로 주입합니다. 모든 사이트 접근 권한이 필요 없습니다.
- 인라인 요소로 나뉜 문장은 노드 사이에 `‖`를 넣은 줄과 넣지 않은 줄을 함께 번역해, 앞의 결과로 노드를 나누고
  뒤의 결과에서 띄어쓰기를 가져옵니다(`lib/text.ts`). 나눌 수 없으면 노드별로 다시 번역합니다.

| 파일 | 내용 |
|---|---|
| `entrypoints/background.ts` | 메뉴, 단축키, 배지, 오프스크린 문서 관리, 번역 요청 중계 |
| `entrypoints/translator.content.ts` | 페이지 번역과 복원 |
| `entrypoints/offscreen/` | 엔진 파일을 읽어 샌드박스에 넘기고 요청 중계 |
| `entrypoints/engine.sandbox/` | hdTrans 엔진 |
| `entrypoints/popup/`, `entrypoints/options/` | 팝업, 설정과 사전 편집 |
| `lib/dictionary.ts` | 사전 규칙, 주소 매칭, TSV 변환 |
| `lib/text.ts` | 엔진 입력 줄 만들기와 결과 되돌리기 |

## 제한

- Chrome(MV3) 기준입니다. Firefox는 오프스크린 문서와 샌드박스 페이지를 지원하지 않아 아직 동작하지 않습니다.
- 메인 프레임만 번역합니다(다른 출처의 iframe은 제외).
- 엔진이 처음 뜰 때 사전을 메모리에 올리므로 첫 번역은 1초 안팎 더 걸리고, 엔진과 사전이 오프스크린 문서에 계속 상주합니다(메모리 사용량은 아직 측정하지 않음).

## 라이선스

hdTrans가 AGPL-3.0-or-later이므로 이 확장도 같은 라이선스를 따릅니다.

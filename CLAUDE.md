# Tail App — Claude Code 프로젝트 가이드

## 프로젝트 개요
리얼타임 로그 뷰어 (Unix `tail -f` 대체 GUI 앱)  
Windows(.msi) + macOS(.dmg) 동시 배포 목표

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프레임워크 | Tauri 2.x |
| 백엔드 | Rust |
| 프론트엔드 | React + TypeScript + Vite |
| 스타일 | Tailwind CSS |
| 상태관리 | Zustand |
| 가상스크롤 | @tanstack/react-virtual |

---

## 프로젝트 초기 세팅

```bash
# 사전 요구사항
# - Rust (https://rustup.rs)
# - Node.js 18+

npm create tauri-app@latest tail-app
# 선택: React → TypeScript → Vite

cd tail-app
npm install zustand @tanstack/react-virtual
npm install -D tailwindcss @types/node

npm run tauri dev
```

---

## 디렉토리 구조

```
tail-app/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── file.rs       # 파일 읽기, tail, watch
│   │   │   ├── encoding.rs   # 인코딩 감지/변환
│   │   │   └── search.rs     # 검색, 필터
│   │   └── models/
│   │       └── bookmark.rs   # 즐겨찾기 구조체
│   └── Cargo.toml
│
└── src/
    ├── components/
    │   ├── TabBar/           # 멀티탭
    │   ├── LogViewer/        # 가상스크롤 뷰어
    │   ├── SearchBar/        # 검색 UI
    │   ├── FilterPanel/      # 필터 패널
    │   ├── Sidebar/          # 즐겨찾기 목록
    │   └── Toolbar/          # 인코딩, follow 토글
    ├── stores/
    │   ├── tabStore.ts
    │   ├── bookmarkStore.ts
    │   └── settingsStore.ts
    ├── hooks/
    │   ├── useFileWatcher.ts
    │   └── useVirtualScroll.ts
    └── App.tsx
```

---

## Rust 의존성 (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = [] }
tokio = { version = "1", features = ["full"] }
notify = "6"          # 파일 변경 감지
encoding_rs = "0.8"   # EUC-KR, CP949, UTF-16 등
chardet = "0.2"       # 인코딩 자동 감지
regex = "1"           # 정규식 검색
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

---

## Rust ↔ React 인터페이스 (Commands)

```rust
// 파일 끝에서 N줄 읽기
#[tauri::command]
async fn read_tail(path: String, lines: usize, encoding: String) -> Result<Vec<LogLine>, String>

// 실시간 감시 시작 → 이벤트("new_log_line")로 새 줄 push
#[tauri::command]
async fn start_watch(path: String, window: tauri::Window) -> Result<(), String>

// 감시 중지
#[tauri::command]
async fn stop_watch(path: String) -> Result<(), String>

// 검색
#[tauri::command]
async fn search_file(path: String, query: String, is_regex: bool) -> Result<Vec<SearchResult>, String>

// 인코딩 자동 감지
#[tauri::command]
async fn detect_encoding(path: String) -> Result<String, String>
```

```typescript
// React에서 호출
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const lines = await invoke('read_tail', { path, lines: 1000, encoding: 'UTF-8' })

await listen('new_log_line', (event) => {
  appendLine(event.payload)
})
```

---

## 핵심 데이터 모델 (TypeScript)

```typescript
interface LogLine {
  index: number
  content: string
  raw: string
  level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  timestamp?: string
}

interface Tab {
  id: string
  filePath: string
  alias: string
  encoding: string
  isFollowing: boolean   // F모드(실시간 추적) 여부
  scrollPosition: number
  highlights: HighlightRule[]
}

interface Bookmark {
  id: string
  filePath: string
  alias: string
  encoding: string
  group?: string
  lastLine?: number
}

interface HighlightRule {
  pattern: string
  color: string
  isRegex: boolean
}
```

---

## 구현할 기능 목록

### MVP (1단계)
- [ ] 파일 열기 + tail 읽기 (마지막 N줄)
- [ ] 실시간 follow 모드 (F키 토글)
- [ ] 멀티탭
- [ ] 파일 인코딩 설정 (UTF-8, EUC-KR, CP949, UTF-16, 자동감지)
- [ ] 즐겨찾기 (그룹, 별칭, 마지막 위치 기억)

### Beta (2단계)
- [ ] 검색 (키워드 / 정규식, 대소문자 구분, 이전/다음, 히스토리)
- [ ] 필터 (포함/제외, 로그레벨 자동감지, 프리셋 저장)
- [ ] 가상 스크롤 (수백만 줄 대응)
- [ ] 하이라이트 규칙 (키워드별 색상, 규칙 저장)

### Full Release (3단계)
- [ ] JSON 로그 → 컬럼 뷰 변환
- [ ] 타임스탬프 파싱 + 시간대 변환
- [ ] 필터/검색 결과 내보내기 (.txt, .csv)
- [ ] SSH 원격 파일 지원

---

## 개발 순서 (Claude Code 작업 흐름)

```
Step 1  프로젝트 생성 + Tailwind 설정 + 기본 레이아웃 (사이드바 / 탭바 / 뷰어)
Step 2  Rust: read_tail 커맨드 구현 + React에서 파일 열기
Step 3  Rust: start_watch / stop_watch + follow 모드 UI
Step 4  가상 스크롤 적용 (react-virtual)
Step 5  검색 UI + Rust 검색 커맨드
Step 6  필터 패널 + 로그레벨 자동 감지
Step 7  즐겨찾기 (저장: Tauri Store 플러그인)
Step 8  인코딩 자동 감지 + 수동 변경
Step 9  하이라이트 규칙
Step 10 빌드 패키징 (Windows .msi / macOS .dmg)
```

---

## 빌드 & 배포

```bash
# 개발
npm run tauri dev

# 프로덕션 빌드
npm run tauri build
# 결과물:
#   Windows → src-tauri/target/release/bundle/msi/*.msi
#   macOS   → src-tauri/target/release/bundle/dmg/*.dmg
```

---

## 참고 링크
- Tauri 공식 문서: https://tauri.app/
- Tauri 2.x 마이그레이션: https://tauri.app/v2/guides/
- notify crate: https://docs.rs/notify/latest/notify/
- encoding_rs: https://docs.rs/encoding_rs/latest/encoding_rs/

import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";

interface HelpModalProps {
  appVersion: string;
  onClose: () => void;
}

interface Section {
  title: string;
  items: { label: string; desc: string }[];
}

const CONTENT = {
  ko: {
    tabs: ["사용 설명서", "단축키", "앱 정보"],
    manual: [
      {
        title: "파일 열기",
        items: [
          { label: "파일 선택", desc: "사이드바 하단의 '파일 열기' 버튼을 클릭합니다." },
          { label: "드래그 앤 드롭", desc: "파일을 앱 창으로 끌어다 놓으면 새 탭으로 열립니다." },
          { label: "즐겨찾기", desc: "사이드바 즐겨찾기 목록에서 클릭하면 바로 열립니다. ★ 버튼으로 추가합니다." },
          { label: "SSH 원격 파일", desc: "사이드바 SSH 섹션에서 접속을 추가하고, 접속 항목을 클릭해 원격 파일을 엽니다." },
        ],
      },
      {
        title: "실시간 모니터링",
        items: [
          { label: "▶ 재생 / ⏸ 일시정지", desc: "툴바 우측 버튼 또는 F 키로 실시간 follow 모드를 토글합니다." },
          { label: "탭 인디케이터", desc: "● 초록: 실시간 · ● 노랑: 실시간 + 미확인 변경 · ⏸ 회색: 정지 · ⏸ 주황: 정지 + 미확인 변경" },
          { label: "최신 줄로 이동", desc: "재생 중 위로 스크롤하면 '↓ 최신 줄로' 버튼이 나타납니다." },
          { label: "대용량 파일", desc: `최근 ${(200_000).toLocaleString()}줄만 표시합니다. 상단에 안내 배너가 나타나며, 이전 내용은 검색으로 확인하세요.` },
        ],
      },
      {
        title: "검색",
        items: [
          { label: "검색 열기", desc: "Ctrl+F (macOS: Cmd+F) 또는 Esc 키로 닫습니다." },
          { label: "네비게이션 모드", desc: "검색 중에도 모든 줄이 표시됩니다. 매치된 줄로만 이동하며 하이라이트됩니다." },
          { label: "결과 탐색", desc: "Enter: 다음 매치로 스크롤 · Shift+Enter: 이전 매치로 스크롤" },
          { label: "정규식 / 대소문자", desc: "검색창의 '정규식', '대소문자 구분' 버튼으로 토글합니다." },
          { label: "줄 이동", desc: "검색창에 :N 입력 후 Enter로 N번 줄로 바로 이동합니다. (예: :1234)" },
        ],
      },
      {
        title: "필터",
        items: [
          { label: "로그 레벨", desc: "ERROR / WARN / INFO / DEBUG 각 레벨을 켜고 끕니다. 레벨이 없는 줄은 전체 선택 시에만 표시됩니다." },
          { label: "포함 텍스트", desc: "입력한 텍스트가 포함된 줄만 표시합니다." },
          { label: "제외 텍스트", desc: "입력한 텍스트가 포함된 줄을 숨깁니다." },
          { label: "초기화", desc: "'✕ 초기화' 버튼으로 모든 필터를 원래대로 되돌립니다." },
        ],
      },
      {
        title: "하이라이트",
        items: [
          { label: "규칙 추가", desc: "툴바의 '규칙' 버튼을 클릭해 패널을 엽니다. 패턴과 색상을 지정하면 해당 줄이 강조됩니다." },
          { label: "정규식 지원", desc: "패턴 입력란 옆 정규식 버튼(.*)으로 정규식 패턴을 사용할 수 있습니다." },
          { label: "규칙 삭제", desc: "각 규칙 오른쪽의 ✕ 버튼으로 삭제합니다." },
        ],
      },
      {
        title: "줄바꿈",
        items: [
          { label: "토글", desc: "툴바의 '줄바꿈' 버튼으로 켜고 끕니다. 켜면 긴 줄이 자동으로 줄 바꿈되어 가로 스크롤 없이 전체 내용을 볼 수 있습니다." },
          { label: "주의", desc: "줄바꿈 모드에서는 가상 스크롤이 동적 높이로 작동하여 렌더링이 다소 느릴 수 있습니다." },
        ],
      },
      {
        title: "사이드바",
        items: [
          { label: "너비 조정", desc: "사이드바 오른쪽 가장자리를 드래그해 너비를 조정합니다." },
          { label: "숨기기 / 펼치기", desc: "사이드바 상단의 ‹ 버튼으로 숨깁니다. 숨기면 아이콘 띠(44px)로 표시됩니다. 아이콘 클릭 또는 › 버튼으로 다시 펼칩니다." },
        ],
      },
      {
        title: "인코딩",
        items: [
          { label: "변경", desc: "툴바의 인코딩 버튼(예: UTF-8 ▾)을 클릭해 변경합니다. 변경 즉시 파일을 다시 읽습니다." },
          { label: "지원 인코딩", desc: "UTF-8 · EUC-KR · CP949 · UTF-16 · UTF-16BE" },
          { label: "우클릭 재해석", desc: "텍스트를 선택한 후 우클릭 → '다음 인코딩으로 재해석' → 인코딩 선택 시 원본과 변환 결과를 팝업으로 비교할 수 있습니다." },
        ],
      },
      {
        title: "내보내기",
        items: [
          { label: "현재 표시 줄만 저장", desc: "필터·검색 결과에 표시된 줄만 내보냅니다. 전체 파일이 아닌 현재 뷰 기준입니다." },
          { label: "텍스트 (.txt)", desc: "줄 내용만 저장합니다." },
          { label: "CSV (.csv)", desc: "index, level, timestamp, content 컬럼으로 저장합니다." },
        ],
      },
      {
        title: "SSH 원격 파일",
        items: [
          { label: "접속 추가", desc: "사이드바 SSH 섹션의 + 버튼으로 호스트/포트/사용자명/인증 방식을 설정합니다." },
          { label: "인증 방식", desc: "비밀번호 · SSH 키 파일 · 기본 키 자동 탐색(~/.ssh/id_ed25519 등) 중 선택합니다." },
          { label: "원격 파일 열기", desc: "SSH 접속 항목 클릭 → 원격 파일 경로 입력 → '열기'를 누릅니다." },
          { label: "제한 사항", desc: "SSH 파일은 즐겨찾기에 추가할 수 없습니다." },
        ],
      },
      {
        title: "멀티탭",
        items: [
          { label: "탭 전환", desc: "상단 TabBar에서 탭을 클릭해 전환합니다." },
          { label: "탭 닫기", desc: "탭 오른쪽의 ✕ 버튼을 클릭합니다." },
          { label: "동시 모니터링", desc: "여러 탭을 열어두면 각각 독립적으로 follow 모드가 동작합니다." },
        ],
      },
    ] as Section[],
    shortcuts: [
      { label: "F", desc: "일시정지 / 재생 토글" },
      { label: "Ctrl+F  /  Cmd+F", desc: "검색 열기" },
      { label: "Enter", desc: "다음 검색 결과로 스크롤" },
      { label: "Shift+Enter", desc: "이전 검색 결과로 스크롤" },
      { label: "Esc", desc: "검색 닫기" },
      { label: ":N  (검색창에서)", desc: "N번 줄로 바로 이동 (예: :1234 입력 후 Enter)" },
    ],
    about: {
      name: "Logr — 리얼타임 로그 뷰어",
      desc: "Unix tail -f를 대체하는 실시간 로그 뷰어",
      features: "멀티탭 · 검색 · 필터 · 하이라이트 · SSH · 인코딩 · 줄바꿈 지원",
      version: "버전",
      license: "라이선스",
      github: "GitHub",
    },
    close: "닫기",
  },
  en: {
    tabs: ["User Guide", "Shortcuts", "About"],
    manual: [
      {
        title: "Opening Files",
        items: [
          { label: "File picker", desc: "Click the 'Open File' button at the bottom of the sidebar." },
          { label: "Drag & drop", desc: "Drag files onto the app window to open them as new tabs." },
          { label: "Bookmarks", desc: "Click a bookmark in the sidebar to open it instantly. Add with the ★ button." },
          { label: "SSH remote files", desc: "Add an SSH connection in the sidebar, then click it to open a remote file." },
        ],
      },
      {
        title: "Realtime Monitoring",
        items: [
          { label: "▶ Resume / ⏸ Pause", desc: "Toggle follow mode using the toolbar button or the F key." },
          { label: "Tab indicators", desc: "● Green: live · ● Amber: live + unread · ⏸ Gray: paused · ⏸ Orange: paused + unread" },
          { label: "Jump to latest", desc: "While following, scrolling up reveals a '↓ Jump to latest' button." },
          { label: "Large files", desc: `Only the last ${(200_000).toLocaleString()} lines are shown. A notice banner appears at the top — use search to find earlier content.` },
        ],
      },
      {
        title: "Search",
        items: [
          { label: "Open search", desc: "Ctrl+F (macOS: Cmd+F). Press Esc to close." },
          { label: "Navigation mode", desc: "All lines remain visible while searching. Matches are highlighted and you navigate between them." },
          { label: "Navigate results", desc: "Enter: scroll to next match · Shift+Enter: scroll to previous match" },
          { label: "Regex / Case", desc: "Toggle 'Regex' and 'Case sensitive' buttons in the search bar." },
          { label: "Jump to line", desc: "Type :N in the search bar then Enter to jump to line N (e.g., :1234)." },
        ],
      },
      {
        title: "Filter",
        items: [
          { label: "Log levels", desc: "Toggle ERROR / WARN / INFO / DEBUG. Lines without a level are shown only when all levels are selected." },
          { label: "Include text", desc: "Show only lines containing the entered text." },
          { label: "Exclude text", desc: "Hide lines containing the entered text." },
          { label: "Reset", desc: "Click '✕ Reset' to clear all filters." },
        ],
      },
      {
        title: "Highlights",
        items: [
          { label: "Add rule", desc: "Click the 'Rules' button in the toolbar. Set a pattern and color to highlight matching lines." },
          { label: "Regex support", desc: "Use the regex button next to the pattern input for regex patterns." },
          { label: "Delete rule", desc: "Click the ✕ button on any rule to remove it." },
        ],
      },
      {
        title: "Word Wrap",
        items: [
          { label: "Toggle", desc: "Click the 'Wrap' button in the toolbar. When on, long lines wrap automatically — no horizontal scrolling needed." },
          { label: "Note", desc: "Word wrap uses dynamic row heights, which may be slightly slower to render." },
        ],
      },
      {
        title: "Sidebar",
        items: [
          { label: "Resize", desc: "Drag the right edge of the sidebar to resize it." },
          { label: "Collapse / Expand", desc: "Click the ‹ button to collapse the sidebar to an icon strip (44px). Click the icons or › to expand again." },
        ],
      },
      {
        title: "Encoding",
        items: [
          { label: "Change encoding", desc: "Click the encoding button (e.g., UTF-8 ▾) in the toolbar. The file reloads immediately." },
          { label: "Supported encodings", desc: "UTF-8 · EUC-KR · CP949 · UTF-16 · UTF-16BE" },
          { label: "Right-click re-interpret", desc: "Select text, right-click → 'Re-interpret as encoding' → choose an encoding to compare original vs. re-decoded in a popup." },
        ],
      },
      {
        title: "Export",
        items: [
          { label: "Exports visible lines only", desc: "Only lines shown after filter/search are exported — not the entire file." },
          { label: "Text (.txt)", desc: "Saves line content only." },
          { label: "CSV (.csv)", desc: "Saves columns: index, level, timestamp, content." },
        ],
      },
      {
        title: "SSH Remote Files",
        items: [
          { label: "Add connection", desc: "Click + in the SSH section of the sidebar to configure host/port/username/auth." },
          { label: "Auth methods", desc: "Password · SSH key file · Auto-detect default keys (~/.ssh/id_ed25519, etc.)" },
          { label: "Open remote file", desc: "Click an SSH connection → enter remote path → click 'Open'." },
          { label: "Limitations", desc: "SSH files cannot be bookmarked." },
        ],
      },
      {
        title: "Multi-tab",
        items: [
          { label: "Switch tabs", desc: "Click tabs in the TabBar at the top." },
          { label: "Close tab", desc: "Click the ✕ button on the tab." },
          { label: "Simultaneous monitoring", desc: "Each open tab follows independently." },
        ],
      },
    ] as Section[],
    shortcuts: [
      { label: "F", desc: "Toggle pause / resume" },
      { label: "Ctrl+F  /  Cmd+F", desc: "Open search" },
      { label: "Enter", desc: "Scroll to next search result" },
      { label: "Shift+Enter", desc: "Scroll to previous search result" },
      { label: "Esc", desc: "Close search" },
      { label: ":N  (in search bar)", desc: "Jump to line N (e.g., type :1234 then Enter)" },
    ],
    about: {
      name: "Logr — Realtime Log Viewer",
      desc: "A GUI replacement for Unix tail -f",
      features: "Multi-tab · Search · Filter · Highlight · SSH · Encoding · Word Wrap",
      version: "Version",
      license: "License",
      github: "GitHub",
    },
    close: "Close",
  },
};

export default function HelpModal({ appVersion, onClose }: HelpModalProps) {
  const { language } = useSettingsStore();
  const [activeTab, setActiveTab] = useState(0);
  const c = CONTENT[language] ?? CONTENT.ko;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 300, backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-lg overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          width: 560,
          maxWidth: "92vw",
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="flex gap-1">
            {c.tabs.map((tab, i) => (
              <button
                key={i}
                className="px-3 py-1 rounded text-xs font-medium transition-colors"
                style={{
                  backgroundColor: activeTab === i ? "var(--color-accent)" : "transparent",
                  color: activeTab === i ? "#fff" : "var(--color-text-secondary)",
                }}
                onClick={() => setActiveTab(i)}
              >
                {tab}
              </button>
            ))}
          </div>
          <button
            className="text-xs px-2 py-1 rounded hover:opacity-80"
            style={{ color: "var(--color-text-secondary)" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ minHeight: 0 }}>

          {/* 탭 0: 사용 설명서 */}
          {activeTab === 0 && (
            <div className="flex flex-col gap-5">
              {c.manual.map((section) => (
                <div key={section.title} className="flex flex-col gap-2">
                  <div
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {section.title}
                  </div>
                  {section.items.map((item) => (
                    <div key={item.label} className="flex gap-3">
                      <div
                        className="shrink-0 text-xs font-medium"
                        style={{ color: "var(--color-text-primary)", width: 140, paddingTop: 1 }}
                      >
                        {item.label}
                      </div>
                      <div className="text-xs" style={{ color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                        {item.desc}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* 탭 1: 단축키 */}
          {activeTab === 1 && (
            <div className="flex flex-col gap-2">
              {c.shortcuts.map((sc) => (
                <div
                  key={sc.label}
                  className="flex items-center gap-4 px-3 py-2 rounded"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                >
                  <kbd
                    className="shrink-0 text-xs font-mono px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                      minWidth: 140,
                      textAlign: "center",
                    }}
                  >
                    {sc.label}
                  </kbd>
                  <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                    {sc.desc}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 탭 2: 앱 정보 */}
          {activeTab === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {c.about.name}
                </div>
                <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  {c.about.desc}
                </div>
                <div className="text-xs" style={{ color: "var(--color-text-secondary)", opacity: 0.65 }}>
                  {c.about.features}
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--color-border)" }} />
              <div className="flex flex-col gap-2 text-xs">
                {[
                  { key: c.about.version, val: `v${appVersion}`, mono: true },
                  { key: c.about.license, val: "MIT", mono: false },
                  { key: c.about.github, val: "joyful-builder/logr", mono: true, accent: true },
                ].map(({ key, val, mono, accent }) => (
                  <div key={key} className="flex justify-between items-center">
                    <span style={{ color: "var(--color-text-secondary)" }}>{key}</span>
                    <span
                      style={{
                        color: accent ? "var(--color-accent)" : "var(--color-text-primary)",
                        fontFamily: mono ? "monospace" : undefined,
                        fontSize: mono ? 11 : undefined,
                      }}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div
          className="flex justify-end px-5 py-3 shrink-0"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            className="text-xs px-4 py-1.5 rounded hover:opacity-80"
            style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
            onClick={onClose}
          >
            {c.close}
          </button>
        </div>
      </div>
    </div>
  );
}

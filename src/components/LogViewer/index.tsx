import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useTabStore } from "../../stores/tabStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { LogLine } from "../../types";
import { useFileWatcher } from "../../hooks/useFileWatcher";
import { useSshWatcher } from "../../hooks/useSshWatcher";
import SearchBar from "../SearchBar";
import { useT } from "../../i18n";
import FilterPanel, { FilterState, createDefaultFilter, LogLevel } from "../FilterPanel";

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "#f87171",
  WARN: "#fbbf24",
  INFO: "#60a5fa",
  DEBUG: "#94a3b8",
};

const ROW_HEIGHT = 18;

function getLevelColor(level?: string): string {
  return level ? (LEVEL_COLORS[level] ?? "var(--color-text-primary)") : "var(--color-text-primary)";
}

interface MatchInfo {
  lineIndex: number;
  matchStart: number;
  matchEnd: number;
}

function HighlightedContent({
  content,
  color,
  matchStart,
  matchEnd,
  markColor,
}: {
  content: string;
  color: string;
  matchStart?: number;
  matchEnd?: number;
  markColor?: string;
}) {
  if (matchStart === undefined || matchEnd === undefined) {
    return <span style={{ color }}>{content}</span>;
  }
  const markBg = markColor ? `${markColor}55` : "rgba(250, 200, 50, 0.45)";
  return (
    <span style={{ color }}>
      {content.slice(0, matchStart)}
      <mark style={{ backgroundColor: markBg, color: "inherit", borderRadius: 2, padding: "0 1px" }}>
        {content.slice(matchStart, matchEnd)}
      </mark>
      {content.slice(matchEnd)}
    </span>
  );
}

interface LogViewerProps {
  onRegisterExport: (fn: (format: "txt" | "csv") => Promise<void>) => void;
  displayLineCountRef: React.MutableRefObject<number>;
}

export default function LogViewer({ onRegisterExport, displayLineCountRef }: LogViewerProps) {
  const t = useT();
  const { getActiveTab, updateTab } = useTabStore();
  const { defaultTailLines } = useSettingsStore();
  const activeTab = getActiveTab();

  const [lines, setLines] = useState<LogLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // 검색 상태
  const [showSearch, setShowSearch] = useState(false);
  const [searchMatches, setSearchMatches] = useState<MatchInfo[] | null>(null);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // 필터 상태
  const [filter, setFilter] = useState<FilterState>(createDefaultFilter());

  const parentRef = useRef<HTMLDivElement>(null);
  const innerContentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const filePosRef = useRef(0);
  const activeTabIdRef = useRef(activeTab?.id);
  activeTabIdRef.current = activeTab?.id;
  const updateTabRef = useRef(updateTab);
  updateTabRef.current = updateTab;
  const lastLineCountRef = useRef(0);
  const justResumedRef = useRef(false);

  const triggerBounceAnimation = useCallback(() => {
    const el = innerContentRef.current;
    if (!el) return;
    el.animate(
      [
        { transform: "translateY(0px)" },
        { transform: "translateY(-14px)" },
        { transform: "translateY(4px)" },
        { transform: "translateY(0px)" },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }, []);

  // 필터 적용 → 검색 적용 순서로 표시할 줄 결정
  const filteredLines = useMemo(() => {
    const allLevels = ["ERROR", "WARN", "INFO", "DEBUG"] as LogLevel[];
    const allSelected = allLevels.every((l) => filter.levels.has(l));
    const noTextFilter = !filter.includeText && !filter.excludeText;
    if (allSelected && noTextFilter) return lines;

    const contains = filter.caseSensitive
      ? (text: string, pattern: string) => text.includes(pattern)
      : (text: string, pattern: string) => text.toLowerCase().includes(pattern.toLowerCase());

    return lines.filter((line) => {
      // 레벨 필터 활성 시: 레벨 없는 줄도 제외, 선택한 레벨만 통과
      if (!allSelected) {
        if (!line.level || !filter.levels.has(line.level as LogLevel)) return false;
      }
      if (filter.includeText && !contains(line.content, filter.includeText)) return false;
      if (filter.excludeText && contains(line.content, filter.excludeText)) return false;
      return true;
    });
  }, [lines, filter]);

  const displayLines = useMemo(() => {
    if (!searchMatches) return filteredLines;
    return searchMatches.map((m) => filteredLines[m.lineIndex]);
  }, [filteredLines, searchMatches]);

  // displayLines가 커밋될 때마다 내보내기 핸들러를 갱신 (직접 클로저, ref 지연 없음)
  useLayoutEffect(() => {
    displayLineCountRef.current = displayLines.length;
    const snapshot = displayLines;
    onRegisterExport(async (format: "txt" | "csv") => {
      if (!snapshot.length) return;
      const savePath = await save({
        defaultPath: `export.${format}`,
        filters: [format === "csv"
          ? { name: "CSV", extensions: ["csv"] }
          : { name: "Text", extensions: ["txt"] }],
      });
      if (!savePath) return;
      let content: string;
      if (format === "csv") {
        const header = "index,level,timestamp,content\n";
        const rows = snapshot.map(
          (l) => `${l.index + 1},${l.level ?? ""},${l.timestamp ?? ""},${JSON.stringify(l.content)}`
        );
        content = header + rows.join("\n");
      } else {
        content = snapshot.map((l) => l.content).join("\n");
      }
      await invoke("export_lines", { path: savePath, content });
    });
  }, [displayLines, onRegisterExport, displayLineCountRef]);

  // 하이라이트 규칙 적용: 첫 번째 매칭 규칙의 색상 + 매칭 위치 반환
  const lineHighlights = useMemo(() => {
    const rules = activeTab?.highlights ?? [];
    if (!rules.length) return new Map<number, { color: string; start: number; end: number }>();
    const map = new Map<number, { color: string; start: number; end: number }>();
    displayLines.forEach((line, idx) => {
      for (const rule of rules) {
        try {
          const pat = rule.isRegex ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp(pat, "i");
          const m = re.exec(line.content);
          if (m) {
            map.set(idx, { color: rule.color, start: m.index, end: m.index + m[0].length });
            break;
          }
        } catch {}
      }
    });
    return map;
  }, [displayLines, activeTab?.highlights]);

  const virtualizer = useVirtualizer({
    count: displayLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  const isSshTab = !!activeTab?.sshConnectionId;

  // 초기 파일 로드
  useEffect(() => {
    if (!activeTab) { setLines([]); setError(null); filePosRef.current = 0; return; }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setLines([]);
    setSearchMatches(null);
    atBottomRef.current = true;
    filePosRef.current = 0;
    lastLineCountRef.current = 0;
    justResumedRef.current = false;

    const loadPromise = isSshTab
      ? invoke<LogLine[]>("ssh_read_tail", {
          connectionId: activeTab.sshConnectionId,
          remotePath: activeTab.filePath,
          lines: defaultTailLines,
          encoding: activeTab.encoding,
        })
      : invoke<LogLine[]>("read_tail", {
          path: activeTab.filePath,
          lines: defaultTailLines,
          encoding: activeTab.encoding,
        });

    loadPromise.then(async (result) => {
      if (!cancelled) {
        setLines(result);
        updateTab(activeTab.id, { hasUnread: false });
        if (!isSshTab) {
          try {
            const size = await invoke<number>("get_file_size", { path: activeTab.filePath });
            if (!cancelled) filePosRef.current = size;
          } catch {}
        } else {
          try {
            const size = await invoke<number>("ssh_get_file_size", {
              connectionId: activeTab.sshConnectionId,
              remotePath: activeTab.filePath,
            });
            if (!cancelled) filePosRef.current = size;
          } catch {}
        }
      }
    }).catch((err) => {
      if (!cancelled) setError(typeof err === "string" ? err : "파일 읽기 실패");
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.filePath, activeTab?.encoding, defaultTailLines]);

  // 새 줄 추가 (follow 모드)
  const handleNewLines = useCallback((newLines: LogLine[]) => {
    setLines((prev) => {
      const base = prev.length > 0 ? prev[prev.length - 1].index + 1 : 0;
      return [...prev, ...newLines.map((l, i) => ({ ...l, index: base + i }))];
    });
  }, []);

  useFileWatcher(
    isSshTab ? null : (activeTab?.filePath ?? null),
    activeTab?.isFollowing ?? false,
    activeTab?.encoding ?? "UTF-8",
    handleNewLines,
    filePosRef
  );

  useSshWatcher(
    isSshTab ? (activeTab?.sshConnectionId ?? null) : null,
    isSshTab ? (activeTab?.filePath ?? null) : null,
    activeTab?.isFollowing ?? false,
    activeTab?.encoding ?? "UTF-8",
    handleNewLines,
    filePosRef
  );

  // 초기 로드 완료 후 하단 스크롤
  useEffect(() => {
    if (!isLoading && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
  }, [isLoading]);

  // isFollowing이 true로 바뀌면 다음 배치에서 바운스 트리거 준비
  useEffect(() => {
    if (activeTab?.isFollowing) {
      justResumedRef.current = true;
    }
  }, [activeTab?.isFollowing]);

  // 새 줄 도착 시: 하단이면 자동 스크롤, 아니면 hasUnread 표시
  useEffect(() => {
    if (lines.length === 0) return;
    const batchSize = lines.length - lastLineCountRef.current;
    lastLineCountRef.current = lines.length;
    if (atBottomRef.current) {
      if (activeTab?.isFollowing && !searchMatches) {
        virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
        if (justResumedRef.current && batchSize >= 1) {
          justResumedRef.current = false;
          requestAnimationFrame(() => requestAnimationFrame(() => triggerBounceAnimation()));
        }
      }
    } else if (activeTabIdRef.current) {
      updateTabRef.current(activeTabIdRef.current, { hasUnread: true });
    }
  }, [lines.length]);

  // 일시정지 중 파일 변경 감지 (2초 폴링, 로컬 + SSH)
  useEffect(() => {
    if (!activeTab || activeTab.isFollowing) return;
    const tabId = activeTab.id;
    const filePath = activeTab.filePath;
    const connectionId = activeTab.sshConnectionId;
    const intervalId = setInterval(async () => {
      try {
        const size = connectionId
          ? await invoke<number>("ssh_get_file_size", { connectionId, remotePath: filePath })
          : await invoke<number>("get_file_size", { path: filePath });
        if (size > filePosRef.current) {
          updateTabRef.current(tabId, { hasUnread: true });
        }
      } catch {}
    }, 2000);
    return () => clearInterval(intervalId);
  }, [activeTab?.id, activeTab?.filePath, activeTab?.isFollowing, isSshTab]);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom && activeTabIdRef.current) {
      updateTabRef.current(activeTabIdRef.current, { hasUnread: false });
    }
  }, []);

  // ── 검색 ──
  const runSearch = useCallback(
    (query: string, isRegex: boolean, caseSensitive: boolean) => {
      if (!query) { setSearchMatches(null); return; }
      try {
        const flags = caseSensitive ? "" : "i";
        const pattern = isRegex
          ? query
          : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(pattern, flags);

        const matches: MatchInfo[] = [];
        filteredLines.forEach((line, idx) => {
          const m = re.exec(line.content);
          if (m) matches.push({ lineIndex: idx, matchStart: m.index, matchEnd: m.index + m[0].length });
        });
        setSearchMatches(matches);
        setCurrentMatchIdx(0);
        if (matches.length > 0) {
          setTimeout(() => virtualizer.scrollToIndex(0, { align: "center" }), 0);
        }
      } catch {
        setSearchMatches([]);
      }
    },
    [filteredLines]
  );

  const goToMatch = useCallback(
    (idx: number) => {
      if (!searchMatches || searchMatches.length === 0) return;
      const next = (idx + searchMatches.length) % searchMatches.length;
      setCurrentMatchIdx(next);
      virtualizer.scrollToIndex(next, { align: "center" });
    },
    [searchMatches, virtualizer]
  );

  // ── 키보드 단축키 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Ctrl+F / Cmd+F: 검색 열기
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if (isInput) return;

      // F: follow 모드 토글
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) {
        if (activeTab) updateTab(activeTab.id, { isFollowing: !activeTab.isFollowing });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTab?.id, activeTab?.isFollowing]);

  // ── 빈 상태 ──
  if (!activeTab) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-3 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}
      >
        <div style={{ fontSize: 48, opacity: 0.3 }}>📄</div>
        <div className="text-sm font-medium">{t("viewer.openFileHint")}</div>
        <div className="text-xs opacity-60">{t("viewer.openFileSub")}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-2 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}
      >
        <div className="text-xs animate-pulse">{t("viewer.loading")}</div>
        <div className="text-xs opacity-60 truncate max-w-xs">{activeTab.filePath.split(/[\\/]/).pop()}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-2 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "#f87171" }}
      >
        <div className="text-sm font-medium">{t("viewer.fileReadError")}</div>
        <div className="text-xs opacity-80 max-w-sm text-center">{error}</div>
      </div>
    );
  }

  // ── 가상 스크롤 뷰어 ──
  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      style={{ backgroundColor: "var(--color-bg-primary)", position: "relative" }}
    >
      {/* 필터 패널 */}
      <FilterPanel filter={filter} onChange={setFilter} />

      {/* 검색 바 */}
      {showSearch && (
        <SearchBar
          onSearch={runSearch}
          onClose={() => { setShowSearch(false); setSearchMatches(null); }}
          resultCount={searchMatches?.length ?? null}
          currentIndex={currentMatchIdx}
          onPrev={() => goToMatch(currentMatchIdx - 1)}
          onNext={() => goToMatch(currentMatchIdx + 1)}
        />
      )}

      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto font-mono text-xs"
        onScroll={handleScroll}
        style={{ color: "var(--color-text-primary)" }}
      >
        {displayLines.length === 0 ? (
          <div
            className="flex items-center justify-center h-full italic"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {searchMatches !== null ? t("viewer.noSearchResults") : t("viewer.fileEmpty")}
          </div>
        ) : (
          <div ref={innerContentRef} style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const line = displayLines[vRow.index];
              const match = searchMatches?.[vRow.index];
              const isCurrent = searchMatches !== null && vRow.index === currentMatchIdx;
              const hlRule = lineHighlights.get(vRow.index);

              const bgColor = isCurrent
                ? "rgba(79, 142, 247, 0.15)"
                : hlRule
                ? `${hlRule.color}28`
                : line.level === "ERROR"
                ? "rgba(248, 113, 113, 0.06)"
                : "transparent";

              const textColor = hlRule ? hlRule.color : getLevelColor(line.level);

              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute",
                    top: vRow.start,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT,
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: bgColor,
                  }}
                >
                  <span
                    className="shrink-0 text-right select-none"
                    style={{
                      width: 52,
                      minWidth: 52,
                      paddingRight: 8,
                      paddingLeft: 4,
                      color: "var(--color-text-secondary)",
                      opacity: 0.45,
                      fontSize: 11,
                    }}
                  >
                    {line.index + 1}
                  </span>
                  <span
                    className="truncate pr-2"
                    style={{ fontSize: 12, lineHeight: `${ROW_HEIGHT}px`, flex: 1, minWidth: 0 }}
                    title={line.content}
                  >
                    <HighlightedContent
                      content={line.content}
                      color={textColor}
                      matchStart={match?.matchStart ?? hlRule?.start}
                      matchEnd={match?.matchEnd ?? hlRule?.end}
                      markColor={match ? undefined : hlRule?.color}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* follow + 위로 스크롤 시 "최신 줄로" 버튼 */}
      {activeTab.isFollowing && !isAtBottom && (
        <div
          className="absolute bottom-2 right-4 text-xs px-3 py-1 rounded-full cursor-pointer select-none"
          style={{ backgroundColor: "var(--color-accent)", color: "#fff", zIndex: 10 }}
          onClick={() => {
            virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
            atBottomRef.current = true;
            setIsAtBottom(true);
            if (activeTabIdRef.current) {
              updateTabRef.current(activeTabIdRef.current, { hasUnread: false });
            }
          }}
        >
          {t("viewer.jumpToLatest")}
        </div>
      )}
    </div>
  );
}

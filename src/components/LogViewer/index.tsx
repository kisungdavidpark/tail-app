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
// 메모리에 유지할 최대 줄 수 — 초과 시 앞쪽을 잘라냄
const MAX_LINES = 200_000;

function getLevelColor(level?: string): string {
  return level ? (LEVEL_COLORS[level] ?? "var(--color-text-primary)") : "var(--color-text-primary)";
}

function HighlightedContent({
  content,
  color,
  matchStart,
  matchEnd,
  markBg,
}: {
  content: string;
  color: string;
  matchStart?: number;
  matchEnd?: number;
  markBg?: string;
}) {
  if (matchStart === undefined || matchEnd === undefined) {
    return <span style={{ color }}>{content}</span>;
  }
  const bg = markBg ?? "rgba(250, 200, 50, 0.45)";
  return (
    <span style={{ color }}>
      {content.slice(0, matchStart)}
      <mark style={{ backgroundColor: bg, color: "inherit", borderRadius: 2, padding: "0 1px" }}>
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
  const [isCapped, setIsCapped] = useState(false);

  // 검색 상태 — 네비게이션 모드: 전체 뷰 유지, 매칭 줄 강조 + 이동
  const [showSearch, setShowSearch] = useState(false);
  const [searchMatchMap, setSearchMatchMap] = useState<Map<number, { start: number; end: number }> | null>(null);
  const [searchMatchList, setSearchMatchList] = useState<number[]>([]);
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
  // 검색 디바운스 + 파라미터 보존 (filteredLines 변경 시 재검색)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchParamsRef = useRef<{ query: string; isRegex: boolean; caseSensitive: boolean } | null>(null);

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

  // 필터 적용
  const filteredLines = useMemo(() => {
    const allLevels = ["ERROR", "WARN", "INFO", "DEBUG"] as LogLevel[];
    const allSelected = allLevels.every((l) => filter.levels.has(l));
    const noTextFilter = !filter.includeText && !filter.excludeText;
    if (allSelected && noTextFilter) return lines;

    const contains = filter.caseSensitive
      ? (text: string, pattern: string) => text.includes(pattern)
      : (text: string, pattern: string) => text.toLowerCase().includes(pattern.toLowerCase());

    return lines.filter((line) => {
      if (!allSelected) {
        if (!line.level || !filter.levels.has(line.level as LogLevel)) return false;
      }
      if (filter.includeText && !contains(line.content, filter.includeText)) return false;
      if (filter.excludeText && contains(line.content, filter.excludeText)) return false;
      return true;
    });
  }, [lines, filter]);

  // 검색 모드에서도 filteredLines 전체를 표시 (필터링 X, 네비게이션만)
  const displayLines = filteredLines;

  // displayLines 커밋 시 내보내기 핸들러 갱신
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

  // 하이라이트 규칙 — 정규식 컴파일을 미리 캐싱 (useMemo)
  const compiledHighlights = useMemo(() => {
    const rules = activeTab?.highlights ?? [];
    return rules.flatMap((rule) => {
      try {
        const pat = rule.isRegex
          ? rule.pattern
          : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return [{ re: new RegExp(pat, "i"), color: rule.color }];
      } catch {
        return [];
      }
    });
  }, [activeTab?.highlights]);

  // 가시 영역의 줄에 대해서만 하이라이트 계산 (전체 순회 없음)
  const getLineHighlight = useCallback(
    (content: string) => {
      for (const { re, color } of compiledHighlights) {
        re.lastIndex = 0;
        const m = re.exec(content);
        if (m) return { color, start: m.index, end: m.index + m[0].length };
      }
      return null;
    },
    [compiledHighlights]
  );

  const virtualizer = useVirtualizer({
    count: displayLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  const isSshTab = !!activeTab?.sshConnectionId;

  // 초기 파일 로드
  useEffect(() => {
    if (!activeTab) {
      setLines([]); setError(null); filePosRef.current = 0;
      setSearchMatchMap(null); setSearchMatchList([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setLines([]);
    setIsCapped(false);
    setSearchMatchMap(null);
    setSearchMatchList([]);
    searchParamsRef.current = null;
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

  // 새 줄 추가 — MAX_LINES 초과 시 앞쪽 제거
  const handleNewLines = useCallback((newLines: LogLine[]) => {
    setLines((prev) => {
      const base = prev.length > 0 ? prev[prev.length - 1].index + 1 : 0;
      const mapped = newLines.map((l, i) => ({ ...l, index: base + i }));
      const combined = [...prev, ...mapped];
      if (combined.length > MAX_LINES) {
        setIsCapped(true);
        return combined.slice(combined.length - MAX_LINES);
      }
      return combined;
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

  // 초기 로드 후 하단 스크롤
  useEffect(() => {
    if (!isLoading && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
  }, [isLoading]);

  // isFollowing이 true로 바뀌면 다음 배치에서 바운스 준비
  useEffect(() => {
    if (activeTab?.isFollowing) {
      justResumedRef.current = true;
    }
  }, [activeTab?.isFollowing]);

  // 새 줄 도착: 하단이면 자동 스크롤, 아니면 hasUnread
  useEffect(() => {
    if (lines.length === 0) return;
    const batchSize = lines.length - lastLineCountRef.current;
    lastLineCountRef.current = lines.length;
    if (atBottomRef.current) {
      if (activeTab?.isFollowing && !searchMatchMap) {
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

  // 일시정지 중 파일 변경 감지 (2초 폴링)
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

  // ── 검색 (네비게이션 모드) ──
  const runSearch = useCallback(
    (query: string, isRegex: boolean, caseSensitive: boolean) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (!query) {
        setSearchMatchMap(null);
        setSearchMatchList([]);
        return;
      }

      searchTimerRef.current = setTimeout(() => {
        // ":N" 줄 번호로 이동
        if (/^:\d+$/.test(query.trim())) {
          const lineNum = parseInt(query.trim().slice(1), 10);
          const targetIdx = filteredLines.findIndex((l) => l.index + 1 === lineNum);
          if (targetIdx >= 0) {
            requestAnimationFrame(() =>
              virtualizer.scrollToIndex(targetIdx, { align: "center" })
            );
          }
          setSearchMatchMap(new Map());
          setSearchMatchList([]);
          return;
        }

        try {
          const flags = caseSensitive ? "" : "i";
          const pattern = isRegex
            ? query
            : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp(pattern, flags);

          const matchMap = new Map<number, { start: number; end: number }>();
          const matchList: number[] = [];
          filteredLines.forEach((line, idx) => {
            re.lastIndex = 0;
            const m = re.exec(line.content);
            if (m) {
              matchMap.set(idx, { start: m.index, end: m.index + m[0].length });
              matchList.push(idx);
            }
          });

          setSearchMatchMap(matchMap);
          setSearchMatchList(matchList);
          setCurrentMatchIdx(0);
          if (matchList.length > 0) {
            requestAnimationFrame(() =>
              virtualizer.scrollToIndex(matchList[0], { align: "center" })
            );
          }
        } catch {
          setSearchMatchMap(new Map());
          setSearchMatchList([]);
        }
      }, 200);
    },
    [filteredLines, virtualizer]
  );

  // runSearch 최신 참조 유지 (re-search effect에서 사용)
  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;

  // filteredLines 변경 시 진행 중인 검색 재실행
  useEffect(() => {
    const p = searchParamsRef.current;
    if (p?.query) {
      runSearchRef.current(p.query, p.isRegex, p.caseSensitive);
    }
  }, [filteredLines]);

  // 검색 파라미터 저장 후 runSearch 호출
  const handleSearch = useCallback(
    (query: string, isRegex: boolean, caseSensitive: boolean) => {
      searchParamsRef.current = query ? { query, isRegex, caseSensitive } : null;
      runSearch(query, isRegex, caseSensitive);
    },
    [runSearch]
  );

  const goToMatch = useCallback(
    (idx: number) => {
      if (searchMatchList.length === 0) return;
      const next = (idx + searchMatchList.length) % searchMatchList.length;
      setCurrentMatchIdx(next);
      virtualizer.scrollToIndex(searchMatchList[next], { align: "center" });
    },
    [searchMatchList, virtualizer]
  );

  // ── 키보드 단축키 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if (isInput) return;

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

      {/* 대용량 파일 캡 알림 */}
      {isCapped && (
        <div
          className="shrink-0 px-3 py-1 text-xs select-none"
          style={{ backgroundColor: "rgba(251,191,36,0.08)", borderBottom: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}
        >
          {t("viewer.cappedNotice")}
        </div>
      )}

      {/* 검색 바 */}
      {showSearch && (
        <SearchBar
          onSearch={handleSearch}
          onClose={() => {
            setShowSearch(false);
            setSearchMatchMap(null);
            setSearchMatchList([]);
            searchParamsRef.current = null;
          }}
          resultCount={searchMatchMap !== null ? searchMatchList.length : null}
          currentIndex={currentMatchIdx}
          onPrev={() => goToMatch(currentMatchIdx - 1)}
          onNext={() => goToMatch(currentMatchIdx + 1)}
          hasQuery={searchParamsRef.current !== null}
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
            {t("viewer.fileEmpty")}
          </div>
        ) : (
          <div ref={innerContentRef} style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const line = displayLines[vRow.index];
              const searchMatch = searchMatchMap?.get(vRow.index);
              const isCurrent = searchMatchMap !== null && searchMatchList[currentMatchIdx] === vRow.index;
              // 가시 영역 줄에 대해서만 하이라이트 계산
              const hlRule = compiledHighlights.length > 0 ? getLineHighlight(line.content) : null;

              const bgColor = isCurrent
                ? "rgba(79, 142, 247, 0.18)"
                : searchMatch
                ? "rgba(250, 204, 21, 0.07)"
                : hlRule
                ? `${hlRule.color}28`
                : line.level === "ERROR"
                ? "rgba(248, 113, 113, 0.06)"
                : "transparent";

              const textColor = hlRule ? hlRule.color : getLevelColor(line.level);
              // 현재 매칭: 진한 노랑 / 다른 매칭: 옅은 노랑 / 하이라이트 규칙: 규칙 색상
              const markBg = searchMatch
                ? isCurrent
                  ? "rgba(250, 200, 50, 0.65)"
                  : "rgba(250, 200, 50, 0.28)"
                : hlRule
                ? `${hlRule.color}55`
                : undefined;

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
                      matchStart={searchMatch?.start ?? hlRule?.start}
                      matchEnd={searchMatch?.end ?? hlRule?.end}
                      markBg={markBg}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* follow 중 위로 스크롤 시 "최신 줄로" 버튼 */}
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

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
  const { defaultTailLines, wrapLines } = useSettingsStore();
  const activeTab = getActiveTab();

  const [lines, setLines] = useState<LogLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isCapped, setIsCapped] = useState(false);

  // 우클릭 컨텍스트 메뉴
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; selectedText: string;
    lineRaw?: string;   // 클릭된 행의 원본 바이트 (Latin-1)
    lineContent?: string; // 클릭된 행의 현재 표시 텍스트
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

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
    // 줄바꿈 모드에서 measureElement로 동적 높이 측정
    measureElement: wrapLines ? (el) => el.getBoundingClientRect().height : undefined,
    overscan: wrapLines ? 10 : 30,
  });

  // wrapLines 토글 시 캐시된 row 높이 초기화 — 해제 후 ghost 여백 방지
  useEffect(() => {
    virtualizer.measure();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapLines]);

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

  // ── 우클릭 컨텍스트 메뉴 ──
  const ENCODINGS = ["UTF-8", "EUC-KR", "CP949", "UTF-16", "UTF-16BE"];

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!activeTab) return;
    e.preventDefault();
    const selectedText = window.getSelection()?.toString().trim() ?? "";

    // 우클릭된 가상 행의 원본 바이트 가져오기 (data-index 속성으로 탐색)
    let lineRaw: string | undefined;
    let lineContent: string | undefined;
    const rowEl = (e.target as HTMLElement).closest('[data-index]');
    if (rowEl) {
      const idx = parseInt(rowEl.getAttribute('data-index') ?? '-1', 10);
      if (idx >= 0 && displayLines[idx]) {
        lineRaw = displayLines[idx].raw;
        lineContent = displayLines[idx].content;
      }
    }

    setCtxMenu({ x: e.clientX, y: e.clientY, selectedText, lineRaw, lineContent });
  }, [activeTab, displayLines]);

  const handleReEncodeSelected = useCallback(async (
    toEncoding: string,
    selectedText: string,
    lineRaw?: string,
    lineContent?: string,
  ) => {
    setCtxMenu(null);
    if (!lineRaw && !selectedText) return;
    const displayOriginal = selectedText || lineContent || "";
    try {
      let result: string;
      if (lineRaw) {
        // 원본 바이트 기반 재해석: UTF-8 대체문자 문제 없이 정확하게 동작
        result = await invoke<string>("reencode_bytes", { rawLatin1: lineRaw, toEncoding });
      } else {
        const fromEncoding = activeTab?.encoding ?? "UTF-8";
        result = await invoke<string>("reencode_text", { text: selectedText, fromEncoding, toEncoding });
      }
      setReEncodeResult({ original: displayOriginal, encoded: result, encoding: toEncoding });
    } catch {
      setReEncodeResult({ original: displayOriginal, encoded: displayOriginal, encoding: toEncoding });
    }
  }, [activeTab?.encoding]);

  const [reEncodeResult, setReEncodeResult] = useState<{
    original: string; encoded: string; encoding: string;
  } | null>(null);

  // 컨텍스트 메뉴 창 경계 밖으로 나가지 않도록 위치 자동 조정
  useEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;
    const menu = ctxMenuRef.current;
    const rect = menu.getBoundingClientRect();
    let x = ctxMenu.x;
    let y = ctxMenu.y;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [ctxMenu]);

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

  // ── 빈 상태: 앱 이름 + 슬로건 ──
  if (!activeTab) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-4 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}
      >
        {/* 로고 */}
        <div style={{ width: 72, height: 72, borderRadius: 18, overflow: "hidden", boxShadow: "0 4px 24px rgba(79,142,247,0.18)" }}>
          <img src="/logr-icon.png" alt="Logr" style={{ width: "100%", height: "100%" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
        {/* 앱 이름 */}
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px", color: "var(--color-text-primary)", fontFamily: "monospace" }}>
          {t("viewer.openFileHint")}
        </div>
        {/* 슬로건 */}
        <div className="text-xs" style={{ color: "var(--color-text-secondary)", opacity: 0.65, whiteSpace: "nowrap" }}>
          {t("viewer.openFileSub")}
        </div>
        {/* 힌트 */}
        <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--color-text-secondary)", opacity: 0.4 }}>
          <span>파일을 드래그하거나</span>
          <span
            className="px-2 py-0.5 rounded font-mono"
            style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)" }}
          >
            {t("sidebar.openFile")}
          </span>
          <span>버튼을 사용하세요</span>
        </div>
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
        onContextMenu={handleContextMenu}
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
              const markBg = searchMatch
                ? isCurrent ? "rgba(250, 200, 50, 0.65)" : "rgba(250, 200, 50, 0.28)"
                : hlRule ? `${hlRule.color}55` : undefined;

              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={wrapLines ? virtualizer.measureElement : undefined}
                  style={{
                    position: "absolute",
                    top: vRow.start,
                    left: 0,
                    right: 0,
                    // 줄바꿈 모드: height auto (measureElement가 측정)
                    height: wrapLines ? undefined : ROW_HEIGHT,
                    minHeight: ROW_HEIGHT,
                    display: "flex",
                    alignItems: wrapLines ? "flex-start" : "center",
                    backgroundColor: bgColor,
                  }}
                >
                  {/* 줄 번호 */}
                  <span
                    className="shrink-0 text-right select-none"
                    style={{
                      width: 52,
                      minWidth: 52,
                      paddingRight: 8,
                      paddingLeft: 4,
                      paddingTop: wrapLines ? 2 : 0,
                      color: "var(--color-text-secondary)",
                      opacity: 0.45,
                      fontSize: 11,
                      lineHeight: `${ROW_HEIGHT}px`,
                    }}
                  >
                    {line.index + 1}
                  </span>
                  {/* 내용 */}
                  <span
                    className={wrapLines ? "pr-2" : "truncate pr-2"}
                    style={{
                      fontSize: 12,
                      lineHeight: `${ROW_HEIGHT}px`,
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: wrapLines ? "pre-wrap" : "nowrap",
                      wordBreak: wrapLines ? "break-all" : undefined,
                      paddingTop: wrapLines ? 2 : 0,
                      paddingBottom: wrapLines ? 2 : 0,
                    }}
                    title={wrapLines ? undefined : line.content}
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

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 400 }} onClick={() => setCtxMenu(null)} />
          <div
            ref={ctxMenuRef}
            className="fixed flex flex-col py-1 rounded-lg shadow-xl"
            style={{
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 401,
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              minWidth: 200,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {ctxMenu.selectedText ? (
              <>
                {/* 선택 텍스트 미리보기 */}
                <div className="px-3 py-2 text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ opacity: 0.6, marginBottom: 2 }}>{t("ctx.selectedText")}</div>
                  <div
                    className="font-mono truncate"
                    style={{ color: "var(--color-text-primary)", maxWidth: 220 }}
                    title={ctxMenu.selectedText}
                  >
                    {ctxMenu.selectedText.slice(0, 40)}{ctxMenu.selectedText.length > 40 ? "…" : ""}
                  </div>
                </div>
                {/* 인코딩으로 재해석 */}
                <div className="px-3 pt-2 pb-1 text-xs" style={{ color: "var(--color-text-secondary)", opacity: 0.7 }}>
                  {t("ctx.reencodeAs")}
                </div>
                {ENCODINGS.map((enc) => (
                  <button
                    key={enc}
                    className="text-left px-3 py-1.5 text-xs hover:opacity-80 font-mono"
                    style={{ color: "var(--color-text-primary)" }}
                    onClick={() => handleReEncodeSelected(enc, ctxMenu.selectedText, ctxMenu.lineRaw, ctxMenu.lineContent)}
                  >
                    {enc}
                  </button>
                ))}
              </>
            ) : (
              <div className="px-3 py-2 text-xs italic" style={{ color: "var(--color-text-secondary)" }}>
                {t("ctx.noSelection")}
              </div>
            )}
          </div>
        </>
      )}

      {/* 재인코딩 결과 팝업 */}
      {reEncodeResult && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 500, backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={() => setReEncodeResult(null)}
        >
          <div
            className="flex flex-col rounded-lg overflow-hidden"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              width: 520,
              maxWidth: "90vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div
              className="flex items-center justify-between px-4 py-3 text-xs font-semibold"
              style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              <span>{t("ctx.reencodeResult")} — <span style={{ color: "var(--color-accent)", fontFamily: "monospace" }}>{reEncodeResult.encoding}</span></span>
              <button className="hover:opacity-80" onClick={() => setReEncodeResult(null)}>✕</button>
            </div>
            {/* 원문 */}
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="text-xs mb-1" style={{ color: "var(--color-text-secondary)", opacity: 0.6 }}>{t("ctx.original")}</div>
              <div
                className="font-mono text-xs rounded p-2 break-all select-all"
                style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)", lineHeight: 1.6, maxHeight: 80, overflow: "auto" }}
              >
                {reEncodeResult.original}
              </div>
            </div>
            {/* 변환 결과 */}
            <div className="px-4 py-3">
              <div className="text-xs mb-1" style={{ color: "var(--color-text-secondary)", opacity: 0.6 }}>{t("ctx.reencoded")}</div>
              <div
                className="font-mono text-xs rounded p-2 break-all select-all"
                style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-primary)", lineHeight: 1.6, maxHeight: 160, overflow: "auto" }}
              >
                {reEncodeResult.encoded}
              </div>
            </div>
            {/* 푸터 */}
            <div
              className="flex justify-between items-center px-4 py-3 text-xs"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <span style={{ color: "var(--color-text-secondary)", opacity: 0.6 }}>{t("ctx.selectAllHint")}</span>
              <button
                className="px-3 py-1.5 rounded hover:opacity-80"
                style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
                onClick={() => setReEncodeResult(null)}
              >
                {t("ctx.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../../stores/tabStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { LogLine } from "../../types";

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "#f87171",
  WARN: "#fbbf24",
  INFO: "#60a5fa",
  DEBUG: "#94a3b8",
};

function getLevelColor(level?: string): string {
  return level ? (LEVEL_COLORS[level] ?? "var(--color-text-primary)") : "var(--color-text-primary)";
}

export default function LogViewer() {
  const { getActiveTab } = useTabStore();
  const { defaultTailLines } = useSettingsStore();
  const activeTab = getActiveTab();

  const [lines, setLines] = useState<LogLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadLines = useCallback(
    async (filePath: string, encoding: string) => {
      setIsLoading(true);
      setError(null);
      setLines([]);
      try {
        const result = await invoke<LogLine[]>("read_tail", {
          path: filePath,
          lines: defaultTailLines,
          encoding,
        });
        setLines(result);
      } catch (err) {
        setError(typeof err === "string" ? err : "파일 읽기 실패");
      } finally {
        setIsLoading(false);
      }
    },
    [defaultTailLines]
  );

  useEffect(() => {
    if (!activeTab) {
      setLines([]);
      setError(null);
      return;
    }
    loadLines(activeTab.filePath, activeTab.encoding);
  }, [activeTab?.id, activeTab?.filePath]);

  // 로딩 완료 후 하단으로 스크롤
  useEffect(() => {
    if (!isLoading && lines.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isLoading]);

  if (!activeTab) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-3 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}
      >
        <div style={{ fontSize: 48, opacity: 0.3 }}>📄</div>
        <div className="text-sm font-medium">파일을 열어 로그를 확인하세요</div>
        <div className="text-xs opacity-60">사이드바의 "파일 열기" 버튼을 사용하세요</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-2 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}
      >
        <div className="text-xs animate-pulse">로딩 중...</div>
        <div className="text-xs opacity-60 truncate max-w-xs" title={activeTab.filePath}>
          {activeTab.filePath.split(/[\\/]/).pop()}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center flex-1 gap-2 select-none"
        style={{ backgroundColor: "var(--color-bg-primary)", color: "#f87171" }}
      >
        <div className="text-sm font-medium">파일 읽기 오류</div>
        <div className="text-xs opacity-80 max-w-sm text-center">{error}</div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed"
        style={{ color: "var(--color-text-primary)" }}
      >
        {lines.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-xs italic"
            style={{ color: "var(--color-text-secondary)" }}
          >
            파일이 비어 있습니다
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.index}
                  style={{
                    backgroundColor:
                      line.level === "ERROR"
                        ? "rgba(248, 113, 113, 0.06)"
                        : "transparent",
                  }}
                >
                  <td
                    className="text-right pr-3 pl-2 select-none"
                    style={{
                      color: "var(--color-text-secondary)",
                      width: 56,
                      minWidth: 56,
                      paddingTop: 1,
                      paddingBottom: 1,
                      verticalAlign: "top",
                      opacity: 0.5,
                    }}
                  >
                    {line.index + 1}
                  </td>
                  <td
                    className="pr-2 whitespace-pre-wrap break-all"
                    style={{
                      color: getLevelColor(line.level),
                      paddingTop: 1,
                      paddingBottom: 1,
                    }}
                  >
                    {line.content}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

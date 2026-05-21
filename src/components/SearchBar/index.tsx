import { useState, useRef, useEffect } from "react";
import { useT } from "../../i18n";

interface SearchBarProps {
  onSearch: (query: string, isRegex: boolean, caseSensitive: boolean) => void;
  onClose: () => void;
  resultCount: number | null;
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  hasQuery?: boolean;
}

export default function SearchBar({ onSearch, onClose, resultCount, currentIndex, onPrev, onNext, hasQuery }: SearchBarProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onSearch(value, isRegex, caseSensitive);
  };

  const handleToggle = (type: "regex" | "case") => {
    const newRegex = type === "regex" ? !isRegex : isRegex;
    const newCase = type === "case" ? !caseSensitive : caseSensitive;
    if (type === "regex") setIsRegex(newRegex);
    else setCaseSensitive(newCase);
    onSearch(query, newRegex, newCase);
  };

  // ":N" 줄 번호 이동 모드 감지
  const isLineJump = /^:\d*$/.test(query.trim());
  const noResults = resultCount === 0 && hasQuery && !isLineJump;

  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0"
      style={{ height: 36, backgroundColor: "var(--color-bg-tertiary)", borderBottom: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center flex-1 gap-1.5 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLineJump ? t("search.lineJumpPlaceholder") : t("search.placeholder")}
          className="flex-1 text-xs outline-none bg-transparent min-w-0"
          style={{ color: noResults ? "#f87171" : "var(--color-text-primary)" }}
        />
        {/* 줄 이동 모드 배지 */}
        {isLineJump && query.length > 1 && (
          <span
            className="shrink-0 text-xs px-1.5 py-0.5 rounded font-mono"
            style={{ backgroundColor: "rgba(79,142,247,0.15)", color: "var(--color-accent)" }}
          >
            {t("search.lineJump")}
          </span>
        )}
      </div>

      {/* 결과 카운터 */}
      {resultCount !== null && !isLineJump && (
        <span className="text-xs shrink-0" style={{ color: noResults ? "#f87171" : "var(--color-text-secondary)" }}>
          {resultCount === 0 ? t("search.noResults") : `${currentIndex + 1} / ${resultCount}`}
        </span>
      )}

      {/* 이전/다음 (줄 이동 모드가 아닐 때만) */}
      {!isLineJump && (
        <>
          <button className="text-xs px-1 hover:opacity-80" style={{ color: "var(--color-text-secondary)" }} onClick={onPrev} title={t("search.prev")}>▲</button>
          <button className="text-xs px-1 hover:opacity-80" style={{ color: "var(--color-text-secondary)" }} onClick={onNext} title={t("search.next")}>▼</button>
        </>
      )}

      {/* 정규식 토글 */}
      <button
        className="text-xs px-2 py-0.5 rounded font-mono"
        style={{ backgroundColor: isRegex ? "var(--color-accent)" : "var(--color-bg-secondary)", color: isRegex ? "#fff" : "var(--color-text-secondary)" }}
        onClick={() => handleToggle("regex")}
        title={t("search.regex")}
      >
        .*
      </button>

      {/* 대소문자 토글 */}
      <button
        className="text-xs px-2 py-0.5 rounded"
        style={{ backgroundColor: caseSensitive ? "var(--color-accent)" : "var(--color-bg-secondary)", color: caseSensitive ? "#fff" : "var(--color-text-secondary)" }}
        onClick={() => handleToggle("case")}
        title={t("search.case")}
      >
        Aa
      </button>

      <button className="text-xs px-1 hover:opacity-80" style={{ color: "var(--color-text-secondary)" }} onClick={onClose} title={t("search.close")}>✕</button>
    </div>
  );
}

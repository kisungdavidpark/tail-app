import { useRef, useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTabStore } from "../../stores/tabStore";
import { useSettingsStore } from "../../stores/settingsStore";
import HighlightPanel from "../HighlightPanel";
import HelpModal from "../HelpModal";
import { HighlightRule } from "../../types";
import { useT } from "../../i18n";
import type { Language } from "../../i18n/translations";

const ENCODINGS = ["UTF-8", "EUC-KR", "CP949", "UTF-16", "UTF-16BE"];

interface ToolbarProps {
  onExport: (format: "txt" | "csv") => Promise<void>;
  displayLineCountRef: React.MutableRefObject<number>;
}

export default function Toolbar({ onExport, displayLineCountRef }: ToolbarProps) {
  const t = useT();
  const { getActiveTab, updateTab } = useTabStore();
  const { language, setLanguage, wrapLines, setWrapLines } = useSettingsStore();
  const activeTab = getActiveTab();

  const [showEncodings, setShowEncodings] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLineCount, setExportLineCount] = useState(0);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const encodingBtnRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const handleToggleFollow = () => {
    if (!activeTab) return;
    updateTab(activeTab.id, { isFollowing: !activeTab.isFollowing });
  };

  const handleSelectEncoding = (enc: string) => {
    if (!activeTab) return;
    setShowEncodings(false);
    if (enc !== activeTab.encoding) updateTab(activeTab.id, { encoding: enc });
  };

  const handleHighlightsChange = (rules: HighlightRule[]) => {
    if (!activeTab) return;
    updateTab(activeTab.id, { highlights: rules });
  };

  const handleExportAs = async (format: "txt" | "csv") => {
    setShowExportMenu(false);
    setIsExporting(true);
    try {
      await onExport(format);
    } catch (err) {
      console.error("내보내기 실패:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleLanguage = () => {
    const next: Language = language === "ko" ? "en" : "ko";
    setLanguage(next);
  };

  const displayPath = activeTab?.sshConnectionId
    ? `${t("toolbar.sshPrefix")} ${activeTab.filePath}`
    : activeTab?.filePath;

  return (
    <div
      className="flex items-center justify-between px-3 shrink-0 text-xs select-none"
      style={{ height: 28, backgroundColor: "var(--color-bg-secondary)", borderTop: "1px solid var(--color-border)", color: "var(--color-text-secondary)", position: "relative" }}
    >
      <div className="flex items-center gap-3 truncate">
        {activeTab ? (
          <span className="truncate" title={displayPath}>{displayPath}</span>
        ) : (
          <span className="italic">{t("toolbar.noFile")}</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* 줄바꿈 토글 */}
        <button
          className="px-2 py-0.5 rounded text-xs hover:opacity-80 font-mono"
          style={{
            backgroundColor: wrapLines ? "rgba(79,142,247,0.18)" : "var(--color-bg-tertiary)",
            color: wrapLines ? "var(--color-accent)" : "var(--color-text-secondary)",
            border: `1px solid ${wrapLines ? "var(--color-accent)" : "transparent"}`,
          }}
          onClick={() => setWrapLines(!wrapLines)}
          title={wrapLines ? t("toolbar.wrapOn") : t("toolbar.wrapOff")}
        >
          {t("toolbar.wrapLines")}
        </button>

        {/* About 버튼 */}
        <button
          className="px-2 py-0.5 rounded text-xs hover:opacity-80 font-mono"
          style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
          onClick={() => { setShowAbout((v) => !v); setShowEncodings(false); setShowHighlights(false); setShowExportMenu(false); }}
          title={t("about.title")}
        >
          ?
        </button>

        {/* 언어 토글 */}
        <button
          className="px-2 py-0.5 rounded text-xs hover:opacity-80 font-mono"
          style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
          onClick={toggleLanguage}
          title={t("toolbar.language")}
        >
          {language === "ko" ? "KO" : "EN"}
        </button>

        {activeTab && (
          <>
            {/* 인코딩 드롭다운 */}
            <div style={{ position: "relative" }}>
              <span
                ref={encodingBtnRef}
                className="px-2 py-0.5 rounded text-xs cursor-pointer hover:opacity-80"
                style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)", userSelect: "none" }}
                onClick={() => { setShowEncodings((v) => !v); setShowHighlights(false); }}
                title={t("toolbar.changeEncoding")}
              >
                {activeTab.encoding} ▾
              </span>
              {showEncodings && (
                <div
                  className="absolute flex flex-col py-1"
                  style={{ bottom: "calc(100% + 4px)", right: 0, backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", zIndex: 200, minWidth: 110 }}
                >
                  {ENCODINGS.map((enc) => (
                    <button
                      key={enc}
                      className="text-left px-3 py-1.5 text-xs hover:opacity-80"
                      style={{ color: enc === activeTab.encoding ? "var(--color-accent)" : "var(--color-text-primary)", backgroundColor: enc === activeTab.encoding ? "rgba(79,142,247,0.1)" : "transparent" }}
                      onClick={() => handleSelectEncoding(enc)}
                    >
                      {enc}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 내보내기 드롭다운 */}
            <div style={{ position: "relative" }}>
              <button
                className="px-2 py-0.5 rounded text-xs hover:opacity-80"
                style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
                onClick={() => { setExportLineCount(displayLineCountRef.current); setShowExportMenu((v) => !v); setShowEncodings(false); setShowHighlights(false); }}
                disabled={isExporting}
                title={t("toolbar.exportHint")}
              >
                {isExporting ? t("toolbar.exporting") : t("toolbar.export")}
              </button>
              {showExportMenu && (
                <div
                  className="absolute flex flex-col py-1"
                  style={{ bottom: "calc(100% + 4px)", right: 0, backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", zIndex: 200, minWidth: 150 }}
                >
                  <button className="text-left px-3 py-2 text-xs hover:opacity-80" style={{ color: "var(--color-text-primary)" }} onClick={() => handleExportAs("txt")}>
                    {t("toolbar.exportTxt")}
                    <div style={{ color: "var(--color-text-secondary)", fontSize: 10, marginTop: 1 }}>
                      {t("toolbar.exportTxtDesc")} · {exportLineCount.toLocaleString()}{language === "ko" ? "줄" : " lines"}
                    </div>
                  </button>
                  <button className="text-left px-3 py-2 text-xs hover:opacity-80" style={{ color: "var(--color-text-primary)", borderTop: "1px solid var(--color-border)" }} onClick={() => handleExportAs("csv")}>
                    {t("toolbar.exportCsv")}
                    <div style={{ color: "var(--color-text-secondary)", fontSize: 10, marginTop: 1 }}>
                      {t("toolbar.exportCsvDesc")} · {exportLineCount.toLocaleString()}{language === "ko" ? "줄" : " lines"}
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* 하이라이트 규칙 */}
            <button
              className="px-2 py-0.5 rounded text-xs hover:opacity-80"
              style={{
                backgroundColor: (activeTab.highlights?.length ?? 0) > 0 ? "rgba(79,142,247,0.18)" : "var(--color-bg-tertiary)",
                color: (activeTab.highlights?.length ?? 0) > 0 ? "var(--color-accent)" : "var(--color-text-secondary)",
                border: `1px solid ${(activeTab.highlights?.length ?? 0) > 0 ? "var(--color-accent)" : "transparent"}`,
              }}
              onClick={() => { setShowHighlights((v) => !v); setShowEncodings(false); }}
              title={t("toolbar.highlightRules")}
            >
              🎨 {t("toolbar.rules")}{(activeTab.highlights?.length ?? 0) > 0 ? ` (${activeTab.highlights.length})` : ""}
            </button>

            {/* 일시정지 / 재생 */}
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab.isFollowing ? "var(--color-bg-tertiary)" : "var(--color-accent)",
                color: activeTab.isFollowing ? "var(--color-text-secondary)" : "#ffffff",
              }}
              onClick={handleToggleFollow}
              title={t("toolbar.followTooltip")}
            >
              {activeTab.isFollowing ? t("toolbar.pause") : t("toolbar.resume")}
              <span style={{ opacity: 0.6, fontSize: 10, border: "1px solid currentColor", borderRadius: 2, padding: "0 2px", lineHeight: "14px" }}>F</span>
            </button>
          </>
        )}
      </div>

      {/* 하이라이트 패널 */}
      {showHighlights && activeTab && (
        <HighlightPanel rules={activeTab.highlights ?? []} onChange={handleHighlightsChange} onClose={() => setShowHighlights(false)} />
      )}

      {/* Help 다이얼로그 */}
      {showAbout && (
        <HelpModal appVersion={appVersion} onClose={() => setShowAbout(false)} />
      )}

      {/* 드롭다운 닫기용 배경 오버레이 */}
      {(showEncodings || showHighlights || showExportMenu) && (
        <div className="fixed inset-0" style={{ zIndex: 99 }} onClick={() => { setShowEncodings(false); setShowHighlights(false); setShowExportMenu(false); }} />
      )}
    </div>
  );
}

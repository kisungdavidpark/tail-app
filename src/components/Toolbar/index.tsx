import { useTabStore } from "../../stores/tabStore";

export default function Toolbar() {
  const { getActiveTab, updateTab } = useTabStore();
  const activeTab = getActiveTab();

  const handleToggleFollow = () => {
    if (!activeTab) return;
    updateTab(activeTab.id, { isFollowing: !activeTab.isFollowing });
  };

  return (
    <div
      className="flex items-center justify-between px-3 shrink-0 text-xs select-none"
      style={{
        height: 28,
        backgroundColor: "var(--color-bg-secondary)",
        borderTop: "1px solid var(--color-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <div className="flex items-center gap-3 truncate">
        {activeTab ? (
          <>
            <span className="truncate" title={activeTab.filePath}>
              {activeTab.filePath}
            </span>
          </>
        ) : (
          <span className="italic">파일 없음</span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {activeTab && (
          <>
            <span
              className="px-2 py-0.5 rounded text-xs"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              {activeTab.encoding}
            </span>
            <button
              className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab.isFollowing
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
                color: activeTab.isFollowing
                  ? "#ffffff"
                  : "var(--color-text-secondary)",
              }}
              onClick={handleToggleFollow}
              title="Follow 모드 토글 (F)"
            >
              {activeTab.isFollowing ? "● Follow" : "Follow"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

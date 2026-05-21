import { useTabStore } from "../../stores/tabStore";

export default function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useTabStore();

  const getFileName = (filePath: string) =>
    filePath.split(/[\\/]/).pop() ?? filePath;

  return (
    <div
      className="flex items-end overflow-x-auto shrink-0"
      style={{
        height: 36,
        backgroundColor: "var(--color-bg-primary)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {tabs.length === 0 ? (
        <div
          className="flex items-center px-4 text-xs italic"
          style={{ color: "var(--color-text-secondary)", height: "100%" }}
        >
          열린 파일 없음
        </div>
      ) : (
        tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className="flex items-center gap-1 px-3 shrink-0 cursor-pointer select-none transition-colors"
              style={{
                height: "100%",
                maxWidth: 200,
                backgroundColor: isActive
                  ? "var(--color-bg-tertiary)"
                  : "transparent",
                borderRight: "1px solid var(--color-border)",
                borderTop: isActive
                  ? "2px solid var(--color-accent)"
                  : "2px solid transparent",
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              <span
                className="text-xs truncate"
                style={{
                  color: isActive
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)",
                  maxWidth: 140,
                }}
                title={tab.filePath}
              >
                {tab.alias || getFileName(tab.filePath)}
              </span>
              {tab.isFollowing && (
                <span
                  className="text-xs shrink-0"
                  style={{ color: "var(--color-accent)" }}
                  title="Follow 모드"
                >
                  ●
                </span>
              )}
              <button
                className="shrink-0 opacity-50 hover:opacity-100 transition-opacity ml-1 leading-none"
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: 14,
                  lineHeight: 1,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTab(tab.id);
                }}
                title="탭 닫기"
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

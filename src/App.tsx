import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import LogViewer from "./components/LogViewer";
import Toolbar from "./components/Toolbar";

export default function App() {
  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", backgroundColor: "var(--color-bg-primary)" }}
    >
      <TabBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <LogViewer />
      </div>
      <Toolbar />
    </div>
  );
}

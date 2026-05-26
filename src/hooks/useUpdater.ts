import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; progress: number }
  | { phase: "installing" }
  | { phase: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update?.available) {
          setState({ phase: "available", update });
        }
      } catch (e) {
        console.warn("Update check failed", e);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const install = async () => {
    if (state.phase !== "available") return;
    const { update } = state;

    try {
      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setState({ phase: "downloading", progress: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          setState({ phase: "downloading", progress });
        } else if (event.event === "Finished") {
          setState({ phase: "installing" });
        }
      });

      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  };

  const dismiss = () => setState({ phase: "idle" });

  return { state, install, dismiss };
}

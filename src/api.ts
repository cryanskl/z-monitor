import { invoke, isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Snapshot } from "./types";

export const desktop = isTauri();

export async function snapshot(): Promise<Snapshot> {
  if (desktop) return invoke<Snapshot>("get_snapshot");
  const response = await fetch("/api/snapshot");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export async function action(name: string): Promise<string> {
  if (!desktop) throw new Error("请在 z-monitor 桌面应用中使用系统快捷功能");
  return invoke("quick_action", { action: name });
}

export async function openApp(path: string): Promise<void> {
  if (!desktop) throw new Error("请在桌面应用中打开快捷应用");
  await invoke("open_application", { path });
}

export async function openPanel(panel: string, detail = ""): Promise<void> {
  const url = `/?panel=${panel}${detail ? `&detail=${detail}` : ""}`;
  if (!desktop) {
    window.open(
      url,
      panel,
      `width=${panel === "fans" ? 720 : 800},height=${panel === "fans" ? 360 : 680}`,
    );
    return;
  }
  const existing = await WebviewWindow.getByLabel(panel);
  if (existing) {
    await existing.close();
  }
  const win = new WebviewWindow(panel, {
    url,
    title:
      panel === "fans"
        ? "z-monitor · 风扇与温度"
        : panel === "settings"
          ? "z-monitor · 功能管理"
          : "z-monitor · 详细信息",
    width: panel === "fans" ? 720 : 800,
    height: panel === "fans" ? 360 : 680,
    minWidth: panel === "fans" ? 720 : 640,
    minHeight: panel === "fans" ? 360 : 500,
    center: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (event) =>
      reject(new Error(String(event.payload))),
    );
  });
}

export type ActionStatus = Record<string, boolean | number>;
export async function nativeAction(
  action: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  if (!desktop) throw new Error("请在 z-monitor 桌面应用中使用此功能");
  return invoke("native_action", { request: { action, ...options } });
}
export async function actionStatus(): Promise<ActionStatus> {
  return invoke("action_status");
}
export async function setFan(
  id: number,
  rpm: number | null,
): Promise<{ id: number; target?: number; mode: string }> {
  if (!desktop) throw new Error("请在桌面应用中调节风扇");
  return invoke("set_fan", { id, rpm });
}

import { useState } from "react";
import { Plus, Minus, AppWindow } from "lucide-react";
import { useActions } from "../useActions";
import { features, defaultApps } from "../features";
import { usePreferences } from "../preferences";
import { action, openApp, nativeAction, desktop } from "../api";

export function SettingsPanel() {
  const [tab, setTab] = useState<"features" | "apps">("features");
  const [preferences, save] = usePreferences();
  const [selection, setSelection] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { status, statusError, refresh } = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string) => {
    setBusy(id);
    try {
      await action(id);
      await refresh();
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const configure = async (hotkeys: Record<string, number>) => {
    try {
      await nativeAction("configure-hotkeys", { hotkeys });
      save({ ...preferences, hotkeys });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };

  const toggle = (id: string) =>
    save({
      ...preferences,
      enabled: preferences.enabled.includes(id)
        ? preferences.enabled.filter((value) => value !== id)
        : [...preferences.enabled, id],
    });
  const add = async () => {
    try {
      const path = (await action("pick-app")).replace(/\/$/, "");
      if (!path) return;
      if (preferences.customApps.some((app) => app.path === path)) return;
      save({
        ...preferences,
        customApps: [
          ...preferences.customApps,
          {
            path,
            label: path
              .split("/")
              .pop()!
              .replace(/\.app$/, ""),
          },
        ],
      });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <main className="settings-panel native-panel">
      <header className="panel-toolbar" data-tauri-drag-region>
        <div className="segmented">
          <button
            className={tab === "features" ? "selected" : ""}
            onClick={() => setTab("features")}
          >
            快捷功能
          </button>
          <button
            className={tab === "apps" ? "selected" : ""}
            onClick={() => setTab("apps")}
          >
            快捷应用
          </button>
        </div>
      </header>
      <div className="settings-content">
        {tab === "features" ? (
          <div className="table-container">
            <table className="features-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="显示所有快捷功能"
                      checked={preferences.enabled.length === features.length}
                      onChange={(e) =>
                        save({
                          ...preferences,
                          enabled: e.target.checked
                            ? features.map((feature) => feature.id)
                            : [],
                        })
                      }
                    />
                    启用图标
                  </th>
                  <th>名称</th>
                  <th>执行动作</th>
                  <th>描述</th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature) => (
                  <tr key={feature.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={preferences.enabled.includes(feature.id)}
                        onChange={() => toggle(feature.id)}
                        aria-label={`显示${feature.label}`}
                      />
                      <feature.icon size={18} />
                    </td>
                    <td>{feature.label}</td>
                    <td>
                      {["awake", "keep-display", "lock-dock"].includes(
                        feature.id,
                      ) ? (
                        <select
                          aria-label={`${feature.label}快捷键`}
                          value={preferences.hotkeys[feature.id] ?? ""}
                          onChange={(e) => {
                            const hotkeys = { ...preferences.hotkeys };
                            if (e.target.value === "")
                              delete hotkeys[feature.id];
                            else hotkeys[feature.id] = Number(e.target.value);
                            void configure(hotkeys);
                          }}
                        >
                          <option value="">无快捷键</option>
                          <option value={0}>⌃⌥⌘ A</option>
                          <option value={2}>⌃⌥⌘ D</option>
                          <option value={37}>⌃⌥⌘ L</option>
                        </select>
                      ) : feature.id === "shortcuts" ? (
                        <select
                          aria-label="键指如飞触发方式"
                          value={preferences.shortcuts}
                          onChange={(e) => {
                            const mode = e.target.value as "off" | "double";
                            nativeAction(
                              mode === "off"
                                ? "shortcuts-off"
                                : "shortcuts-enable",
                            )
                              .then(() =>
                                save({ ...preferences, shortcuts: mode }),
                              )
                              .catch((e) => setError(String(e)));
                          }}
                        >
                          <option value="off">点击图标</option>
                          <option value="double">双按并按住 ⌘</option>
                        </select>
                      ) : (
                        <button
                          className="native-button"
                          disabled={busy !== null}
                          onClick={() => void run(feature.id)}
                        >
                          {busy === feature.id
                            ? "执行中…"
                            : feature.toggle
                              ? status[feature.id] === true
                                ? "已开启 · 关闭"
                                : "已关闭 · 开启"
                              : "执行"}
                        </button>
                      )}
                    </td>
                    <td title={feature.description}>{feature.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="app-list" role="listbox" aria-label="快捷应用">
            {defaultApps.map((app) => (
              <div className="app-list-row" key={app.id}>
                <app.icon size={16} />
                <button
                  onClick={() =>
                    action(app.id).catch((e) => setError(String(e)))
                  }
                >
                  {app.label}
                </button>
              </div>
            ))}
            {preferences.customApps.map((app) => (
              <div
                role="option"
                aria-selected={selection === app.path}
                tabIndex={0}
                className={`app-list-row ${selection === app.path ? "chosen" : ""}`}
                key={app.path}
                onClick={() => setSelection(app.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    setSelection(app.path);
                }}
                onDoubleClick={() =>
                  openApp(app.path).catch((e) => setError(String(e)))
                }
              >
                <AppWindow size={16} />
                <span>{app.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="settings-footer">
        {tab === "features" ? (
          <>
            <span className="muted">
              显示设置自动保存 ·{" "}
              {desktop
                ? status.accessibility
                  ? "辅助功能已授权"
                  : "辅助功能未授权"
                : "浏览器预览"}
            </span>
            <button
              className="native-button"
              onClick={() =>
                nativeAction("permission")
                  .then(refresh)
                  .catch((e) => setError(String(e)))
              }
            >
              授权辅助功能
            </button>
            <button
              className="native-button"
              onClick={() =>
                save({
                  ...preferences,
                  enabled: features.map((feature) => feature.id),
                })
              }
            >
              重置显示
            </button>
          </>
        ) : (
          <>
            <div className="add-remove">
              <button
                className="native-button"
                aria-label="添加快捷应用"
                onClick={() => void add()}
              >
                <Plus size={14} />
              </button>
              <button
                className="native-button"
                aria-label="移除快捷应用"
                disabled={!selection}
                onClick={() => {
                  save({
                    ...preferences,
                    customApps: preferences.customApps.filter(
                      (app) => app.path !== selection,
                    ),
                  });
                  setSelection(null);
                }}
              >
                <Minus size={14} />
              </button>
            </div>
            <span className="muted">双击打开添加的应用</span>
          </>
        )}
      </footer>
      {(error || statusError) && (
        <div className="panel-error" role="alert">
          {error || statusError}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
    </main>
  );
}

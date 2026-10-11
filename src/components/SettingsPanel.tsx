import { useState } from "react";
import { Plus, Minus, AppWindow } from "lucide-react";
import { features, defaultApps } from "../features";
import { usePreferences } from "../preferences";
import { action, openApp } from "../api";

export function SettingsPanel() {
  const [tab, setTab] = useState<"features" | "apps">("features");
  const [preferences, save] = usePreferences();
  const [selection, setSelection] = useState<string | null>(null);
  const [error, setError] = useState("");
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
                      <span
                        className={`action-tag ${feature.unsupported ? "unavailable" : ""}`}
                      >
                        {feature.unsupported
                          ? "暂不可用"
                          : [
                                "keep-display",
                                "menubar",
                                "displays",
                                "lowpower",
                              ].includes(feature.id)
                            ? "系统设置"
                            : "直接执行"}
                      </span>
                    </td>
                    <td title={feature.unsupported ?? feature.description}>
                      {feature.unsupported ?? feature.description}
                    </td>
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
            <span className="muted">显示设置自动保存</span>
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
      {error && (
        <div className="panel-error" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
    </main>
  );
}

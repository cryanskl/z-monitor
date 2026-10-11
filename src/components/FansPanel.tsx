import { useState } from "react";
import { Fan, Microchip, HelpCircle } from "lucide-react";
import { desktop, openPanel, setFan } from "../api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { groupLabel } from "../format";
import type { Snapshot } from "../types";

export function FansPanel({
  data,
  error,
}: {
  data: Snapshot | null;
  error: string | null;
}) {
  const [group, setGroup] = useState("all");
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [target, setTarget] = useState(0);
  const [busy, setBusy] = useState(false);
  const selected = data?.fans.find((fan) => fan.id === editing);
  const apply = async (id: number, rpm: number | null) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await setFan(id, rpm);
      setNotice(
        rpm === null
          ? "已读回自动模式；当前 RPM 会逐步变化。"
          : `控制器已确认目标 ${Math.round(result.target!)} RPM；实际转速会逐步接近目标。`,
      );
      setEditing(null);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };
  const sensors =
    data?.sensors.filter(
      (sensor) => group === "all" || sensor.group === group,
    ) ?? [];
  const rpm = (value: number | null) =>
    value === null ? "—" : Math.round(value);
  return (
    <main className="fans-panel native-panel">
      <header className="native-title" data-tauri-drag-region>
        z-monitor · 风扇与温度{data ? ` (${data.cpu.name})` : ""}
      </header>
      <div className="fan-toolbar">
        <label>
          运行模式：
          <span className="native-button">
            {data?.fans.some((fan) => fan.mode === 1) ? "手动" : "自动"}
          </span>
        </label>
        <label>
          温度传感器：
          <select
            aria-label="温度传感器分类"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">全部</option>
            {Object.entries(groupLabel).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fan-columns">
        <div className="fan-table-wrap">
          <table className="fan-table">
            <thead>
              <tr>
                <th>风扇</th>
                <th>最小 / 当前 / 最大 RPM</th>
                <th>控制</th>
              </tr>
            </thead>
            <tbody>
              {data?.fans.map((fan) => (
                <tr key={fan.id}>
                  <td>
                    <span className="fan-name">
                      <span className="fan-housing">
                        <Fan size={24} />
                      </span>
                      {data.fans.length === 2
                        ? fan.id === 0
                          ? "左侧风扇"
                          : "右侧风扇"
                        : `风扇 ${fan.id + 1}`}
                    </span>
                  </td>
                  <td className="rpm-cell">
                    <span>{rpm(fan.min)}</span> —{" "}
                    <strong>{rpm(fan.current)}</strong> —{" "}
                    <span>{rpm(fan.max)}</span>
                  </td>
                  <td>
                    <button
                      className="native-button"
                      disabled={busy}
                      onClick={() => void apply(fan.id, null)}
                      title="恢复系统自动调节"
                    >
                      自动
                    </button>
                    <span className="fan-mode">
                      {fan.mode === 0 || fan.mode === 3
                        ? "自动"
                        : fan.mode === 1
                          ? "手动"
                          : "系统控制"}
                    </span>
                    <button
                      className="native-button"
                      disabled={busy || fan.min === null || fan.max === null}
                      title={
                        fan.target === null
                          ? "设置固定转速"
                          : `控制器目标：${Math.round(fan.target)} RPM`
                      }
                      onClick={() => {
                        setTarget(
                          Math.round(
                            Math.max(
                              fan.min!,
                              Math.min(
                                fan.max!,
                                fan.target || fan.current || fan.min!,
                              ),
                            ),
                          ),
                        );
                        setEditing(fan.id);
                        setNotice("");
                      }}
                    >
                      固定转速…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.fans.length && (
            <p className="empty-note">
              未检测到风扇，这台 Mac 可能采用无风扇设计。
            </p>
          )}
        </div>
        <div className="sensor-table-wrap">
          <table className="sensor-table">
            <thead>
              <tr>
                <th>传感器</th>
                <th>温度 °C</th>
              </tr>
            </thead>
            <tbody>
              {sensors.map((sensor) => (
                <tr key={sensor.key}>
                  <td title={`${groupLabel[sensor.group]} · SMC ${sensor.key}`}>
                    <span className={`sensor-name sensor-${sensor.group}`}>
                      <Microchip size={13} />
                      {groupLabel[sensor.group]} · {sensor.key}
                    </span>
                  </td>
                  <td className={sensor.value >= 85 ? "hot" : ""}>
                    {sensor.value.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !sensors.length && (
            <p className="empty-note">未找到这类温度传感器</p>
          )}
        </div>
      </div>
      <footer className="fan-footer">
        <span className="muted">
          {data
            ? `${data.sensors.length} 个传感器 · 每 2 秒更新`
            : (error ?? "正在读取…")}
        </span>
        <div>
          <button
            className="native-button"
            onClick={() => {
              if (desktop)
                getCurrentWindow()
                  .hide()
                  .catch((e) => setNotice(String(e)));
              else window.close();
            }}
          >
            隐藏到菜单栏
          </button>
          <button
            className="native-button"
            onClick={() =>
              openPanel("settings").catch((e) => setNotice(String(e)))
            }
          >
            偏好设置…
          </button>
          <button
            className="help-button"
            aria-label="温度采集说明"
            onClick={() => setHelp(!help)}
          >
            <HelpCircle size={20} />
          </button>
        </div>
      </footer>
      {selected && (
        <div className="dialog-backdrop">
          <form
            className="fan-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(selected.id, target);
            }}
          >
            <h3>风扇 {selected.id + 1} · 固定转速</h3>
            <p>
              设置范围 {Math.ceil(selected.min!)}–{Math.floor(selected.max!)}{" "}
              RPM。首次调节需要管理员授权；设置后会读回控制器确认。
            </p>
            <label>
              目标 RPM{" "}
              <input
                aria-label="目标 RPM"
                type="number"
                min={Math.ceil(selected.min!)}
                max={Math.floor(selected.max!)}
                step={1}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                required
                disabled={busy}
              />
            </label>
            <input
              aria-label="风扇转速滑块"
              type="range"
              min={Math.ceil(selected.min!)}
              max={Math.floor(selected.max!)}
              step={1}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              disabled={busy}
            />
            <p className="muted">
              应用退出或控制连接断开时恢复自动。请先停止其他风扇控制软件，避免相互覆盖。
            </p>
            {notice && (
              <p role="alert" className="hot">
                {notice}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="native-button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="native-button primary"
                disabled={busy}
              >
                {busy ? "等待授权 / 写入确认…" : "应用固定转速"}
              </button>
            </div>
          </form>
        </div>
      )}
      {(help || notice || (data?.issues.length ?? 0) > 0) && (
        <aside className="fan-help">
          {notice || (
            <>
              <strong>来自本机 SMC 的实时读数</strong>
              <p>
                保留传感器原始键名；CPU/GPU
                卡片显示各组温度平均值。“自动”交还系统控制，“固定转速”写入硬件允许范围内的目标并确认读回。实际转速需要几秒变化，控制会话断开会恢复自动。未提供的数据以
                — 显示。
              </p>
              {data?.issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </>
          )}
          <button
            className="link"
            onClick={() => {
              setHelp(false);
              setNotice("");
            }}
          >
            关闭说明
          </button>
        </aside>
      )}
    </main>
  );
}

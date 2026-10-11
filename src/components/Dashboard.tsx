import {
  Cpu,
  Microchip,
  HardDrive,
  MemoryStick,
  Fan,
  Globe,
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  MoreHorizontal,
  LayoutGrid,
} from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { action, desktop, openApp, openPanel } from "../api";
import {
  degrees,
  gb,
  gib,
  percent,
  speed,
  temperature,
  uptime,
} from "../format";
import { features, defaultApps } from "../features";
import { usePreferences } from "../preferences";
import type { Snapshot, Detail } from "../types";
import { Chart } from "./Chart";

function Legend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="legend">
      <span className="legend-label">
        <i style={{ background: color }} />
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

export function Dashboard({
  data,
  history,
  error,
}: {
  data: Snapshot | null;
  history: Snapshot[];
  error: string | null;
}) {
  const [preferences] = usePreferences();
  const [notice, setNotice] = useState("");
  const [awake, setAwake] = useState(false);
  const [clean, setClean] = useState(false);
  useEffect(() => {
    if (desktop)
      invoke<boolean>("awake_status")
        .then(setAwake)
        .catch((e) => setNotice(String(e)));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!clean) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setClean(false);
        if (desktop)
          getCurrentWindow()
            .setFullscreen(false)
            .catch((err) => setNotice(String(err)));
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [clean]);
  const openDetail = (detail: Detail) => {
    openPanel("details", detail).catch((e) => setNotice(String(e)));
  };
  const run = async (id: string) => {
    try {
      if (id === "clean-screen") {
        if (desktop) await getCurrentWindow().setFullscreen(true);
        setClean(true);
        return;
      }
      const result = await action(id);
      if (id === "awake") setAwake(result === "on");
    } catch (e) {
      setNotice(String(e));
    }
  };
  return (
    <main className="dashboard">
      <div
        className="drag-strip"
        data-tauri-drag-region
        aria-label="拖动窗口"
      />
      {clean && (
        <div
          className="clean-screen"
          onDoubleClick={() => {
            setClean(false);
            if (desktop)
              getCurrentWindow()
                .setFullscreen(false)
                .catch((e) => setNotice(String(e)));
          }}
        >
          <span>按 Esc 或双击退出</span>
        </div>
      )}
      <div className="dashboard-body">
        {data ? (
          <div className="metrics-grid">
            <section className="metric-card processor-card">
              <header>
                <button
                  className="card-title"
                  onClick={() => openDetail("cpu")}
                >
                  <Cpu />
                  CPU
                </button>
              </header>
              <div className="card-subtitle">
                <span>{data.cpu.name}</span>
                <button
                  className="link temperature"
                  title="CPU 传感器平均温度"
                  onClick={() =>
                    openPanel("fans").catch((e) => setNotice(String(e)))
                  }
                >
                  {degrees(temperature(data, "cpu"))}
                </button>
              </div>
              <Chart
                label="CPU 最近两分钟使用率"
                series={[
                  {
                    values: history.map((s) => s.cpu.user + s.cpu.system),
                    color: "#fa495c",
                    fill: true,
                  },
                  {
                    values: history.map((s) => s.cpu.user),
                    color: "#45adf5",
                    fill: true,
                  },
                ]}
              />
              <div className="legends">
                <Legend
                  color="#45adf5"
                  label="用户"
                  value={percent(data.cpu.user)}
                />
                <Legend
                  color="#fa495c"
                  label="系统"
                  value={percent(data.cpu.system)}
                />
                <Legend
                  color="#ded8d1"
                  label="闲置"
                  value={percent(data.cpu.idle)}
                />
              </div>
            </section>
            <section className="metric-card processor-card">
              <header>
                <button
                  className="card-title"
                  onClick={() => openDetail("gpu")}
                >
                  <Microchip />
                  GPU
                </button>
              </header>
              <div className="card-subtitle">
                <span>{data.gpu.name}</span>
                <span>
                  {data.gpu.cores === null ? "—" : `${data.gpu.cores} 核`}
                </span>
              </div>
              <Chart
                label="GPU 最近两分钟使用率"
                series={[
                  {
                    values: history.map((s) => s.gpu.usage),
                    color: "#45adf5",
                    fill: true,
                  },
                  {
                    values: history.map((s) => s.gpu.renderer),
                    color: "#fa495c",
                  },
                  { values: history.map((s) => s.gpu.tiler), color: "#32cbb2" },
                ]}
              />
              <div className="legends">
                <Legend
                  color="#45adf5"
                  label="利用率"
                  value={percent(data.gpu.usage)}
                />
                <Legend
                  color="#fa495c"
                  label="渲染利用率"
                  value={percent(data.gpu.renderer)}
                />
                <Legend
                  color="#32cbb2"
                  label="Tiler 利用率"
                  value={percent(data.gpu.tiler)}
                />
              </div>
            </section>
            <section className="metric-card storage-card">
              <header>
                <button
                  className="card-title"
                  onClick={() => openDetail("disk")}
                >
                  <HardDrive />
                  {data.disk.name}
                </button>
                <button
                  className="link temperature"
                  onClick={() =>
                    openPanel("fans").catch((e) => setNotice(String(e)))
                  }
                >
                  {degrees(temperature(data, "disk"))}
                </button>
              </header>
              <div className="capacity">
                <span>可用:{gb(data.disk.available)} GB</span>
                <span>共:{gb(data.disk.total)} GB</span>
              </div>
              <div
                className="progress"
                role="meter"
                aria-label="磁盘已用空间"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  data.disk.total && data.disk.available !== null
                    ? (1 - data.disk.available / data.disk.total) * 100
                    : undefined
                }
              >
                <i
                  style={{
                    width:
                      data.disk.total && data.disk.available !== null
                        ? `${(1 - data.disk.available / data.disk.total) * 100}%`
                        : "0%",
                  }}
                />
              </div>
              <div className="storage-footer">
                <span>R: {speed(data.disk.read)}</span>
                <span>W: {speed(data.disk.write)}</span>
                <button className="link" onClick={() => openDetail("disk")}>
                  详细
                </button>
              </div>
            </section>
            <section className="metric-card storage-card">
              <header>
                <button
                  className="card-title"
                  onClick={() => openDetail("memory")}
                >
                  <MemoryStick />
                  RAM
                </button>
              </header>
              <div className="capacity">
                <span>可用:{gib(data.memory.available)} GB</span>
                <span>共:{gib(data.memory.total)} GB</span>
              </div>
              <div
                className="progress"
                role="meter"
                aria-label="内存使用量"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={(data.memory.used / data.memory.total) * 100}
              >
                <i
                  style={{
                    width: `${(data.memory.used / data.memory.total) * 100}%`,
                  }}
                />
              </div>
              <div className="storage-footer memory-footer">
                <button className="link" onClick={() => openDetail("memory")}>
                  详细
                </button>
              </div>
            </section>
            <section className="metric-card connection-card">
              <header>
                <button
                  className="card-title"
                  onClick={() =>
                    openPanel("fans").catch((e) => setNotice(String(e)))
                  }
                >
                  <Fan />
                  FAN
                </button>
                <button
                  className="link"
                  onClick={() =>
                    openPanel("fans").catch((e) => setNotice(String(e)))
                  }
                >
                  详情
                </button>
              </header>
              <div className="fan-values">
                {data.fans.length ? (
                  data.fans.map((fan) => (
                    <span key={fan.id}>
                      <Fan />
                      {fan.current === null ? "—" : Math.round(fan.current)} RPM
                    </span>
                  ))
                ) : (
                  <span className="muted">未检测到风扇</span>
                )}
              </div>
            </section>
            <section className="metric-card connection-card">
              <header>
                <button
                  className="card-title"
                  onClick={() => openDetail("network")}
                >
                  <Globe />
                  INTERNET
                </button>
                <button
                  className="link"
                  aria-label="网络详情"
                  onClick={() => openDetail("network")}
                >
                  ›
                </button>
              </header>
              <div className="network-values">
                <span>
                  <ArrowDown />
                  {speed(data.network.download)}
                </span>
                <span>
                  <ArrowUp />
                  {speed(data.network.upload)}
                </span>
              </div>
              <button
                className="link ip"
                onClick={() => {
                  if (data.network.ip)
                    navigator.clipboard
                      .writeText(data.network.ip)
                      .then(() => setNotice("IP 地址已复制"))
                      .catch((e) => setNotice(String(e)));
                }}
                title="复制本机 IP"
              >
                <ArrowLeftRight />
                {data.network.ip ?? "网络未连接"}
              </button>
            </section>
          </div>
        ) : (
          <div className="loading">
            <Cpu size={26} />
            <p>{error ?? "正在读取本机数据…"}</p>
          </div>
        )}
        <div className="quick-apps" aria-label="快捷应用">
          {defaultApps.map((app) => (
            <button
              key={app.id}
              title={app.label}
              aria-label={app.label}
              onClick={() => void run(app.id)}
              className={`app-icon ${app.id}`}
            >
              <app.icon />
            </button>
          ))}
          {preferences.customApps.map((app) => (
            <button
              key={app.path}
              className="app-icon"
              title={app.label}
              onClick={() =>
                openApp(app.path).catch((e) => setNotice(String(e)))
              }
            >
              <LayoutGrid />
            </button>
          ))}
        </div>
        <div className="quick-grid">
          {features
            .filter((feature) => preferences.enabled.includes(feature.id))
            .map((feature) => (
              <button
                className={`quick-feature ${feature.id === "awake" && awake ? "is-active" : ""}`}
                key={feature.id}
                disabled={!!feature.unsupported}
                title={feature.unsupported ?? feature.description}
                onClick={() => void run(feature.id)}
                aria-pressed={feature.id === "awake" ? awake : undefined}
              >
                <span className="feature-circle">
                  <feature.icon />
                </span>
                <span className="feature-name">{feature.label}</span>
              </button>
            ))}
          <button
            className="quick-feature"
            onClick={() =>
              openPanel("settings").catch((e) => setNotice(String(e)))
            }
          >
            <span className="feature-circle">
              <LayoutGrid />
            </span>
            <span className="feature-name">功能管理</span>
          </button>
        </div>
      </div>
      <footer className="dashboard-footer">
        <span>开机时间：{data ? uptime(data.uptime) : "—"}</span>
        <button
          title="功能管理"
          aria-label="功能管理"
          onClick={() =>
            openPanel("settings").catch((e) => setNotice(String(e)))
          }
        >
          <MoreHorizontal />
        </button>
      </footer>
      {(notice || (error && data)) && (
        <div className="toast" role="status">
          {notice || error}
        </div>
      )}
    </main>
  );
}

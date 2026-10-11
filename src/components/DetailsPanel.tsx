import { useState } from "react";
import { Chart } from "./Chart";
import { degrees, gb, gib, percent, speed, temperature } from "../format";
import type { Detail, Snapshot } from "../types";

const labels = {
  cpu: "CPU",
  gpu: "GPU",
  disk: "磁盘",
  memory: "内存",
  network: "网络",
};
export function DetailsPanel({
  data,
  history,
  error,
}: {
  data: Snapshot | null;
  history: Snapshot[];
  error: string | null;
}) {
  const selected = new URLSearchParams(location.search).get("detail") ?? "cpu";
  const [tab, setTab] = useState<Detail>(
    selected in labels ? (selected as Detail) : "cpu",
  );
  let rows: [string, string][] = [];
  if (data) {
    if (tab === "cpu")
      rows = [
        ["芯片", data.cpu.name],
        ["逻辑核心", `${data.cpu.cores} 核`],
        ["用户使用率", percent(data.cpu.user)],
        ["系统使用率", percent(data.cpu.system)],
        ["闲置", percent(data.cpu.idle)],
        ["传感器平均温度", degrees(temperature(data, "cpu"))],
      ];
    if (tab === "gpu")
      rows = [
        ["芯片", data.gpu.name],
        ["核心", data.gpu.cores === null ? "—" : `${data.gpu.cores} 核`],
        ["利用率", percent(data.gpu.usage)],
        ["渲染器", percent(data.gpu.renderer)],
        ["Tiler", percent(data.gpu.tiler)],
        ["传感器平均温度", degrees(temperature(data, "gpu"))],
      ];
    if (tab === "disk")
      rows = [
        ["卷宗", data.disk.name],
        ["总容量", `${gb(data.disk.total)} GB`],
        ["可用容量", `${gb(data.disk.available)} GB`],
        ["读取速度", speed(data.disk.read)],
        ["写入速度", speed(data.disk.write)],
        ["传感器平均温度", degrees(temperature(data, "disk"))],
        ["速率范围", "所有 IOBlockStorageDriver 的合计"],
      ];
    if (tab === "memory")
      rows = [
        ["物理内存", `${gib(data.memory.total)} GiB`],
        ["已用内存", `${gib(data.memory.used)} GiB`],
        ["其余物理内存", `${gib(data.memory.available)} GiB`],
        ["压缩内存", `${gib(data.memory.compressed)} GiB`],
      ];
    if (tab === "network")
      rows = [
        ["本机 IPv4", data.network.ip ?? "未连接"],
        ["下载速度", speed(data.network.download)],
        ["上传速度", speed(data.network.upload)],
        ["采集范围", "en* 物理网络接口；不重复计算虚拟隧道"],
      ];
  }
  return (
    <main className="details-panel native-panel">
      <header className="panel-toolbar" data-tauri-drag-region>
        <div className="segmented">
          {Object.entries(labels).map(([key, label]) => (
            <button
              className={tab === key ? "selected" : ""}
              key={key}
              onClick={() => setTab(key as Detail)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="details-content">
        <h1>{labels[tab]} 实时信息</h1>
        {data ? (
          <>
            <dl>
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {(tab === "cpu" || tab === "gpu" || tab === "memory") && (
              <div className="detail-chart">
                <Chart
                  large
                  label={`${labels[tab]} 最近两分钟使用率`}
                  series={[
                    {
                      color: "#159dfa",
                      fill: true,
                      values: history.map((s) =>
                        tab === "cpu"
                          ? s.cpu.user + s.cpu.system
                          : tab === "gpu"
                            ? s.gpu.usage
                            : (s.memory.used / s.memory.total) * 100,
                      ),
                    },
                  ]}
                />
                <div>
                  <span>最近 2 分钟</span>
                  <span>当前 · 每 2 秒更新</span>
                </div>
              </div>
            )}
            <p className="detail-explanation">
              {tab === "memory"
                ? "已用内存 = 活跃 + 有线 + 压缩 − 可清除内存。macOS 会自动回收缓存；这里不执行强制释放。"
                : tab === "disk"
                  ? "容量来自 APFS 数据卷。读写速度根据存储驱动累计字节的变化计算，以十进制 MB/s 显示。"
                  : tab === "network"
                    ? "速度为物理接口接收与发送字节的采样差值。IPv4 是本机局域网地址。"
                    : "曲线仅记录应用运行后收到的真实样本。温度来自可读 SMC 传感器的平均值，详情面板保留原始键名。"}
            </p>
            {data.issues.length > 0 && (
              <div className="inline-error">{data.issues.join("\n")}</div>
            )}
          </>
        ) : (
          <p>{error ?? "正在读取本机数据…"}</p>
        )}
      </div>
    </main>
  );
}

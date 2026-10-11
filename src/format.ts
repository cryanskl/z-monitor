import type { Snapshot, Sensor } from "./types";

export const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)}%`;
export const gb = (value: number | null) =>
  value === null ? "—" : (value / 1e9).toFixed(1);
export const gib = (value: number) => (value / 1024 ** 3).toFixed(1);
export function speed(value: number) {
  return value >= 1e6
    ? `${(value / 1e6).toFixed(1)} MB/s`
    : `${Math.round(value / 1e3)} KB/s`;
}
export function temperature(data: Snapshot, group: Sensor["group"]) {
  const sensors = data.sensors.filter((sensor) => sensor.group === group);
  return sensors.length
    ? sensors.reduce((sum, sensor) => sum + sensor.value, 0) / sensors.length
    : null;
}
export const degrees = (value: number | null) =>
  value === null ? "— °C" : `${value.toFixed(1)}°C`;
export function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分钟`;
}
export const groupLabel = {
  cpu: "CPU",
  gpu: "GPU",
  disk: "磁盘",
  battery: "电池",
  system: "系统",
};

export interface Sensor {
  key: string;
  group: "cpu" | "gpu" | "disk" | "battery" | "system";
  value: number;
}
export interface Fan {
  id: number;
  current: number | null;
  min: number | null;
  max: number | null;
  mode: number | null;
}
export interface Snapshot {
  timestamp: number;
  uptime: number;
  cpu: {
    name: string;
    cores: number;
    user: number;
    system: number;
    idle: number;
  };
  gpu: {
    name: string;
    cores: number | null;
    usage: number | null;
    renderer: number | null;
    tiler: number | null;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    compressed: number;
  };
  disk: {
    name: string;
    total: number | null;
    available: number | null;
    read: number;
    write: number;
  };
  network: { download: number; upload: number; ip: string | null };
  sensors: Sensor[];
  fans: Fan[];
  issues: string[];
}
export type Detail = "cpu" | "gpu" | "disk" | "memory" | "network";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

// The browser preview reads the same native collector as the packaged application.
// System-changing actions are available only through Tauri IPC.
function nativePreview(): Plugin {
  return {
    name: "native-telemetry-preview",
    configureServer(server) {
      execFileSync("/bin/bash", ["scripts/build-native.sh"], {
        stdio: "inherit",
      });
      const collector = spawn("src-tauri/binaries/monitor", [], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let snapshot: string | null = null;
      let error: string | null = null;
      const lines = createInterface({ input: collector.stdout });
      lines.on("line", (line) => {
        JSON.parse(line);
        snapshot = line;
      });
      collector.stderr.on("data", (data) => {
        error = String(data);
        console.error(error);
      });
      collector.on("exit", (code) => {
        error = `系统采集进程已停止 (${code})`;
        snapshot = null;
      });
      server.middlewares.use("/api/snapshot", (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.statusCode = snapshot ? 200 : 503;
        res.end(
          snapshot ?? JSON.stringify({ error: error ?? "正在读取系统数据…" }),
        );
      });
      server.httpServer!.once("close", () => {
        lines.close();
        collector.kill();
      });
      process.once("exit", () => collector.kill());
    },
  };
}

export default defineConfig({
  plugins: [react(), nativePreview()],
  server: { host: "127.0.0.1", port: 1427, strictPort: true },
  clearScreen: false,
});

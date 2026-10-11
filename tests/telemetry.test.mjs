import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";

test(
  "native collector produces two coherent live macOS snapshots",
  { timeout: 15000 },
  async () => {
    const child = spawn("src-tauri/binaries/monitor", [], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      const samples = [];
      for await (const line of lines) {
        const data = JSON.parse(line);
        assert.ok(data.timestamp > 0);
        assert.ok(data.uptime > 0);
        assert.ok(data.cpu.cores > 0);
        assert.ok(
          Math.abs(data.cpu.user + data.cpu.system + data.cpu.idle - 100) <
            0.001,
        );
        for (const key of ["user", "system", "idle"])
          assert.ok(data.cpu[key] >= 0 && data.cpu[key] <= 100);
        assert.ok(
          data.memory.used >= 0 && data.memory.used <= data.memory.total,
        );
        assert.equal(
          data.memory.used + data.memory.available,
          data.memory.total,
        );
        assert.ok(
          data.disk.available >= 0 && data.disk.available <= data.disk.total,
        );
        assert.ok(data.disk.read >= 0 && data.disk.write >= 0);
        assert.ok(data.network.download >= 0 && data.network.upload >= 0);
        for (const sensor of data.sensors) {
          assert.match(sensor.key, /^T.{3}$/);
          assert.ok(
            Number.isFinite(sensor.value) &&
              sensor.value >= 10 &&
              sensor.value < 150,
          );
        }
        for (const fan of data.fans) {
          assert.ok(fan.current === null || fan.current >= 0);
          assert.ok(fan.min === null || fan.max === null || fan.min < fan.max);
        }
        samples.push(data);
        if (samples.length === 2) break;
      }
      assert.equal(samples.length, 2, stderr);
      assert.ok(samples[1].timestamp > samples[0].timestamp + 1);
      assert.ok(samples[1].uptime > samples[0].uptime);
    } finally {
      lines.close();
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  },
);

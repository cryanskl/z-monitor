import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "zm-actions-test-"));
const host = join(directory, "action-host");
execFileSync("/usr/bin/xcrun", [
  "swiftc",
  "tests/ActionHost.swift",
  "-o",
  host,
  "-framework",
  "AppKit",
]);
process.on("exit", () => rmSync(directory, { recursive: true }));
const run = (requests) =>
  execFileSync(
    host,
    [resolve("src-tauri/binaries/libactions.dylib"), JSON.stringify(requests)],
    {
      timeout: 20000,
      env: {
        ...process.env,
        Z_MONITOR_NATIVE_DIR: resolve("src-tauri/binaries"),
      },
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
test("awake and display assertions exist in macOS and are released on shutdown", () => {
  const results = run([
    { action: "awake" },
    { wait: 0.2 },
    { action: "keep-display" },
    { "inspect-power": true },
    { action: "shutdown" },
    { "inspect-power": true },
    { action: "status" },
  ]);
  assert.equal(results[0].value.awake, true);
  assert.equal(results[1].value["keep-display"], true);
  assert.match(results[2].power, /z-monitor display awake/);
  assert.match(results[2].power, /z-monitor system awake/);
  assert.doesNotMatch(results[4].power, /z-monitor display awake/);
  assert.equal(results[5].value.awake, false);
  assert.equal(results[5].value["keep-display"], false);
});
test("missing accessibility permission rejects keyboard interception without claiming it is active", () => {
  const [initial, result, final] = run([
    { action: "status" },
    { action: "clean-keyboard", seconds: 1 },
    { action: "shutdown" },
  ]);
  if (initial.value.accessibility) {
    assert.equal(result.ok, true);
  } else {
    assert.equal(result.ok, false);
    assert.match(result.error, /辅助功能/);
  }
  assert.equal(final.ok, true);
});
test("invalid external hotkey and cleaning inputs are rejected", () => {
  const results = run([
    { action: "configure-hotkeys", hotkeys: { "lock-dock": 99 } },
    { action: "clean-screen", seconds: -1 },
    { action: "unknown" },
    { action: "shutdown" },
  ]);
  for (const result of results.slice(0, 3)) assert.equal(result.ok, false);
});
test("fan helper exposes live capabilities and refuses an unprivileged control session", () => {
  assert.match(
    execFileSync("src-tauri/binaries/fan-control", ["--probe"], {
      encoding: "utf8",
    }),
    /fanCount=\d/,
  );
  assert.throws(
    () =>
      execFileSync(
        "src-tauri/binaries/fan-control",
        ["--session", "1", "501", "/tmp/invalid"],
        { stdio: "pipe" },
      ),
    /Command failed/,
  );
});

test(
  "power session accepts the kernel request and releases its sleep assertion after parent loss",
  { timeout: 10000 },
  async () => {
    const child = spawn("src-tauri/binaries/power-control", [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data) => (stderr += data));
    const exited = once(child, "exit");
    try {
      const [ready] = await Promise.race([
        once(child.stdout, "data"),
        exited.then(() => {
          throw new Error(stderr || "Power session exited before ready");
        }),
      ]);
      assert.equal(String(ready).trim(), "ready");
      assert.match(
        execFileSync("/usr/bin/pmset", ["-g", "assertions"], {
          encoding: "utf8",
        }),
        /z-monitor system awake/,
      );
    } finally {
      child.stdin.end();
      await exited;
    }
    assert.equal(stderr, "");
    assert.doesNotMatch(
      execFileSync("/usr/bin/pmset", ["-g", "assertions"], {
        encoding: "utf8",
      }),
      /z-monitor system awake/,
    );
  },
);

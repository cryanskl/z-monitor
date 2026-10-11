# z-monitor

一个本地 macOS 系统监控工具，使用 **Tauri 2 + React + TypeScript**，通过轻量 Swift 原生采集进程读取真实系统数据。界面参考用户提供的 Stats 风格卡片和 Macs Fan Control 温度面板。

## 已实现

- CPU 用户、系统、闲置使用率，以及最近两分钟的真实采样曲线。
- GPU 使用率、渲染器与 Tiler 使用率、GPU 核心数量。
- APFS 数据卷容量、存储驱动读写速度。
- 物理内存、已用内存和压缩内存。
- 网络下载、上传、局域网 IPv4 地址和开机时长。
- SMC 温度传感器、风扇当前/最低/最高 RPM 与可读的风扇模式。
- 菜单栏图标：左键显示/隐藏主面板，右键菜单可显示面板或退出。
- 快捷功能显示管理与本地保存；自定义快捷应用添加、移除、打开。
- 系统设置、磁盘工具、系统信息、隐私设置、活动监视器快捷入口。
- 防止空闲休眠、深色模式、锁屏、屏保、黑屏清洁、桌面图标和 Dock 显示切换。

## 运行与构建

开发环境需要 macOS、Node.js 22+、Rust stable 与 Xcode Command Line Tools。运行打包后的应用不需要 Node、Python、Rust 或 Xcode。

```bash
npm ci
npm run desktop
```

仅预览 React 界面（同样读取本机数据，但系统操作只能在桌面应用中执行）：

```bash
npm run dev
```

开发服务只绑定 `127.0.0.1:1427`，不会托管到外网。预览 API 仅提供监控数据，没有系统操作入口。

```bash
npm run native:build
npm test
npm run check
npm run package
```

产物位于 `src-tauri/target/release/bundle/macos/z-monitor.app` 和 `src-tauri/target/release/bundle/dmg/`。当前提供 Apple Silicon 构建；配置的最低系统版本是 macOS 13，实际验收平台为 Apple M4 Pro / macOS 26。Intel 和其他芯片尚未做硬件验收。

产物使用本地 ad-hoc 签名，未使用 Apple Developer ID，也未经过 Apple 公证。源码可自行构建；不能将该产物描述为已经公证、可在所有 Mac 上无提示安装的正式发行版本。

## 数据来源与边界

采集器常驻，每两秒输出一份 JSON 快照。CPU、磁盘与网络速度都由累计计数的采样差值计算，图表不填充虚构历史。

| 指标 | 来源 / 计算 |
| --- | --- |
| CPU | Mach `host_statistics`；用户包含 nice，使用率为两次 tick 差值 |
| GPU | IOKit `IOAccelerator/PerformanceStatistics`，不可读字段显示 `—` |
| 内存 | Mach `host_statistics64`；已用 = active + wired + compressed − purgeable |
| 磁盘容量 | `/System/Volumes/Data` 的 APFS 卷容量 |
| 磁盘速度 | 所有 `IOBlockStorageDriver` 累计读写字节的合计差值；包含外接存储 |
| 网络速度 | `getifaddrs` 中 `en*` 物理接口的累计字节差值，不重复计算虚拟隧道 |
| 温度 / 风扇 | AppleSMC user client，只执行键枚举与读取 |

温度只接受 `flt ` / `sp78` 编码、10–150 °C 范围内的读数，忽略不可用、占位和非温度编码。CPU/GPU/磁盘卡片显示相应前缀传感器的平均值；前缀分组是硬件适配策略，不保证每个键对应独立物理核心。详情保留原始 SMC 键名，便于核对。传感器读错会公开显示采集错误。

磁盘以十进制 GB 显示；内存卡片按常见习惯以 1024³ 换算，详情明确标注 GiB。“可用内存”为物理总量减去上述已用值，不等同于内存压力或可分配上限。

**风扇控制当前只读。** 可显示系统/现有风扇软件设置的模式，但不会切换自动模式或设置固定 RPM。界面上的固定转速按钮禁用。没有安装特权 helper，也不使用 sudo。

“保持亮屏”“自动隐藏菜单栏”“扩展监视器”“省电模式”打开对应 macOS 设置；功能说明中明确标注。`caffeinate -i -s` 阻止空闲/接电休眠，**不保证合盖不休眠**，退出应用会释放该进程。锁屏与外观切换可能需要 macOS 自动化/辅助功能授权，拒绝授权会显示系统错误。

清洁键盘、隐藏刘海、清倒废纸篓、锁定 Dock 和跨应用快捷键读取尚未接入，显示为禁用并提供原因。内存按钮为“详细”，不执行 `purge` 或主动制造内存压力。

监控数据只在本机处理；应用没有远程 API、统计上报或云服务。GitHub 仓库只包含源码、依赖锁和图标，不包含本机快照或 IP 地址。

## 源码结构

```text
src/                 React 界面、实时快照和偏好设置
native/Monitor.swift Mach / IOKit / SMC 只读采集器
src-tauri/src/       窗口、菜单栏、固定白名单系统操作
scripts/             Swift 采集器编译
tests/               本机实时采样集成验证
```

SMC 是非公开硬件接口，兼容性可能随系统或芯片变化。接口调研参考 [Stats 的 SMC 实现](https://github.com/exelban/stats/blob/master/SMC/smc.swift)；本项目独立实现只读的 80 字节协议请求，未引入其风扇写入 helper。菜单栏和窗口使用 [Tauri 官方 API](https://v2.tauri.app/learn/system-tray/)。

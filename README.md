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
- 合盖/空闲防休眠、保持亮屏、深色模式、锁屏、屏保和屏幕/键盘清洁。
- 桌面图标、Dock、菜单栏自动隐藏；刘海背景融合；锁定 Dock 到当前显示器。
- 当前应用菜单快捷键读取，双按并按住 ⌘ 呼出；防休眠/亮屏/Dock 锁定可配置全局快捷键。
- 已连接显示器的扩展模式、低电量模式直接切换、废纸篓确认清空、系统缓存释放。
- 风扇自动控制与固定 RPM；管理员会话、硬件范围验证、目标/模式读回、退出恢复自动。

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
| 温度 / 风扇 | 采集器只读取 AppleSMC；独立管理员会话按需写入风扇模式与目标 |

温度只接受 `flt ` / `sp78` 编码、10–150 °C 范围内的读数，忽略不可用、占位和非温度编码。CPU/GPU/磁盘卡片显示相应前缀传感器的平均值；前缀分组是硬件适配策略，不保证每个键对应独立物理核心。详情保留原始 SMC 键名，便于核对。传感器读错会公开显示采集错误。

磁盘以十进制 GB 显示；内存卡片按常见习惯以 1024³ 换算，详情明确标注 GiB。“可用内存”为物理总量减去上述已用值，不等同于内存压力或可分配上限。

## 功能与授权

所有快捷入口均已接入实际操作，浏览器预览不能执行系统动作。macOS 权限仍由用户授权，拒绝时明确显示错误。

| 功能 | 实际行为 / 要求 |
| --- | --- |
| 合盖不休眠 | 保持 idle-sleep assertion，并通过 IOPMrootDomain 的合盖接口阻止合盖休眠；关闭/正常退出/父进程断开时释放并恢复。本机已确认接口接受请求；实际合盖持续运行需人工验收。 |
| 保持亮屏 | 创建 NoDisplaySleep assertion；再次点击或退出释放。 |
| 深色模式 | System Events 外观切换，需要自动化授权。 |
| 锁屏 / 屏保 | 系统锁屏接口 / ScreenSaverEngine；锁屏不会保存密码或自动解锁。 |
| 清洁屏幕 / 键盘 | 所有屏幕黑色覆盖；键盘清洁拦截 keyDown/keyUp/flagsChanged，需要辅助功能；点击退出或 60 秒倒计时恢复。屏幕清洁也可 Esc 退出。 |
| 桌面 / Dock / 菜单栏 | 直接切换系统偏好并读回；桌面/Dock 重启对应进程。 |
| 隐藏刘海 | 按 NSScreen.safeAreaInsets 绘制黑色菜单背景，保留菜单点击。无刘海显示器提示不适用。 |
| 清倒废纸篓 | 先弹永久删除确认，确认后请求 Finder 清空；需要自动化授权。 |
| 扩展监视器 | 将已镜像的连接显示器解除镜像并排列为扩展；已经扩展时保持布局；没有外接屏时提示连接。无线屏需要先由系统完成配对。 |
| 锁定 Dock | 读取 Dock 当前显示器，并在其他屏幕 Dock 边缘拦截鼠标触边迁移；需要辅助功能，保持显示器间通行。 |
| 键指如飞 | 读取前台/最后使用应用的 AX 菜单快捷键；双按并按住 ⌘ 显示、松开隐藏。应用未公开的自定义快捷键无法凭空读取。 |
| 省电模式 | pmset 直接设置电池与接电低电量模式并读回；需要管理员授权。 |
| RAM 释放 | 请求系统 purge 清理可回收缓存，需要管理员授权；不终止应用，也不承诺固定释放量。 |
| 快捷应用 | 原生 .app 选择器，添加/移除/打开，本地保存；取消选择不报错。 |
| 风扇控制 | 真实 SMC 最小/最大范围内设置 RPM，读回目标和模式；实际机械转速逐步变化。首次控制弹管理员提示。 |

风扇会话使用受限本地 Unix socket，校验连接 UID/PID，只接受 fan id/RPM，不提供任意命令接口；无常驻 root 服务、sudoers 修改或全局权限放宽。M1–M4 的 Ftst 握手与 Intel FS! bitmask 分别处理。退出或连接断开时尝试把本应用接管的风扇恢复自动；恢复错误记录到进程 stderr。操作前请停止其他风扇/防休眠控制软件，避免它们覆盖设置。

macOS 上接受的 socket 会继承非阻塞状态，控制连接在接受后显式切回阻塞读取并保留超时。SMC 写入与读数更新存在延迟，手动模式、目标转速和恢复自动模式均等待有限次读回确认；恢复确认前保留本应用的风扇控制记录。

本地签名更新后，辅助功能列表的开启状态可能与新版进程的实际权限不一致。先重启应用；若功能管理仍显示未授权，在系统辅助功能列表移除旧条目，再通过“＋”添加实际运行的新版 `.app`。以应用内“辅助功能已授权”和操作结果为准。

系统操作的结果或错误提示会保留到手动关闭；开始下一次系统操作时清除旧提示。管理员授权期间离开主面板后，仍能回来核对结果。

快捷功能亮起状态来自系统或原生操作层。系统偏好（桌面、Dock、菜单栏、外观、低电量模式）由用户主动切换，保持系统设置的通常持久行为；临时状态（亮屏、防休眠、键盘拦截、刘海覆盖、Dock 边缘拦截）随应用退出释放。

## 验证范围

`npm test` 包含真实采样、系统电源 assertion 的创建/释放、合盖接口请求与父进程断开清理、权限不足拒绝、输入边界、风扇能力和非管理员拒绝。`npm run check`、生产构建与 DMG 打包另行验证。

本轮另行通过原生 UI 验证：400×768 主面板真实数据、保持亮屏开关及系统请求、防休眠启停、全屏清洁与 Esc 退出、桌面/Dock/菜单栏切换读回与恢复、风扇编辑器硬件范围、管理员提示触发/测试请求结束、自定义应用添加/打开/移除/取消、废纸篓确认取消。当前启用显示器无刘海，验证了明确的不适用提示。

后续授权验收已确认：重新添加辅助功能权限后应用识别授权、键盘清洁覆盖启动与鼠标退出、Dock 锁定启停、深色模式切换与恢复、磁盘工具/系统信息/活动监视器窗口打开、快捷键配置保存与清除、省电模式电池与接电配置均读回开启并恢复关闭。全局按键拦截、快捷键辅助面板和硬件场景仍需完成实际操作验收。

风扇实机验收通过：左侧目标 3500 RPM、右侧目标 3600 RPM，模式与目标均读回确认，实际转速接近目标；单独恢复左侧自动时右侧保持手动。退出应用后两侧均读回自动模式，Ftst 回到 0，管理员 helper 退出。该结果仅代表本次 Apple M4 Pro / macOS 26.5.2 的验收。

自动测试通过不代表所有系统操作已完成硬件验收。缓存清理、授权后的键盘拦截/跨应用 AX、外接显示器迁移、物理合盖、实际清空用户废纸篓需要相应权限、硬件或用户确认。没有实际操作证据时不能把这些项目标记为“已实机通过”。

监控数据只在本机处理；应用没有远程 API、统计上报或云服务。GitHub 仓库只包含源码、依赖锁和图标，不包含本机快照或 IP 地址。

## 源码结构

```text
src/                 React 界面、实时快照和偏好设置
native/main.swift    Mach / IOKit / SMC 只读采集器
native/Actions.swift 原生界面、输入拦截、AX 与系统偏好（静态链接）
native/FanControl.swift  按需管理员风扇会话
native/PowerControl.swift  防休眠与父进程断开恢复
native/SMC.swift      独立实现的 SMC ABI 编解码
src-tauri/src/       窗口、菜单栏、固定白名单系统操作
scripts/             Swift 采集器编译
tests/               本机实时采样集成验证
```

SMC 是非公开硬件接口，兼容性可能随系统或芯片变化。接口调研参考 [Stats 的 SMC 实现](https://github.com/exelban/stats/blob/master/SMC/smc.swift)；本项目独立实现 80 字节协议请求与受限风扇会话。合盖接口与属性更新时间参考 [Apple XNU RootDomainUserClient](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/Kernel/RootDomainUserClient.cpp) 和 [IOPMrootDomain](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/Kernel/IOPMrootDomain.cpp)。菜单栏和窗口使用 [Tauri 官方 API](https://v2.tauri.app/learn/system-tray/)。

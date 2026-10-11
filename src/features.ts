import {
  Coffee,
  Contrast,
  Monitor,
  MonitorPlay,
  Sparkles,
  Keyboard,
  Eye,
  Dock,
  Laptop,
  PanelTop,
  Trash2,
  PanelsTopLeft,
  AppWindow,
  Grid3X3,
  Zap,
  LayoutGrid,
  Settings,
  HardDrive,
  Info,
  Shield,
  Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface Feature {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  toggle?: boolean;
  permission?: string;
}
export const features: Feature[] = [
  {
    id: "awake",
    label: "合盖不休眠",
    icon: Coffee,
    description: "阻止空闲及合盖休眠；关闭或退出应用恢复",
    toggle: true,
  },
  {
    id: "dark",
    label: "深色模式",
    icon: Contrast,
    description: "切换 macOS 的深色与浅色外观",
    toggle: true,
    permission: "自动化 System Events",
  },
  {
    id: "lock",
    label: "锁屏",
    icon: Monitor,
    description: "直接调用系统锁屏接口",
  },
  {
    id: "keep-display",
    label: "保持亮屏",
    icon: Monitor,
    description: "阻止显示器自动关闭，再次点击恢复；退出应用自动释放",
    toggle: true,
  },
  {
    id: "screensaver",
    label: "进入屏保",
    icon: MonitorPlay,
    description: "立即启动 macOS 屏幕保护程序",
  },
  {
    id: "clean-screen",
    label: "清洁屏幕",
    icon: Sparkles,
    description: "显示全屏黑色画面；按 Esc 退出",
  },
  {
    id: "clean-keyboard",
    label: "清洁键盘",
    icon: Keyboard,
    description: "拦截所有键盘输入；鼠标点击退出，60 秒后自动恢复",
    permission: "辅助功能",
  },
  {
    id: "desktop",
    label: "隐藏桌面文件",
    icon: Eye,
    description: "隐藏或显示桌面图标；Finder 会重新启动",
    toggle: true,
  },
  {
    id: "dock",
    label: "隐藏程序坞",
    icon: Dock,
    description: "切换 Dock 自动隐藏；Dock 会重新启动",
    toggle: true,
  },
  {
    id: "notch",
    label: "隐藏刘海儿",
    icon: Laptop,
    description: "用黑色菜单栏背景融合刘海，保留菜单点击；再次点击恢复",
    toggle: true,
  },
  {
    id: "menubar",
    label: "自动隐藏菜单栏",
    icon: PanelTop,
    description: "直接切换菜单栏自动隐藏",
    toggle: true,
  },
  {
    id: "trash",
    label: "清倒废纸篓",
    icon: Trash2,
    description: "删除废纸篓中的文件",
    permission: "自动化 Finder",
  },
  {
    id: "displays",
    label: "扩展监视器",
    icon: PanelsTopLeft,
    description: "将已连接显示器切换为扩展模式；需要外接显示器",
  },
  {
    id: "lock-dock",
    label: "锁定 Dock",
    icon: AppWindow,
    description: "阻止鼠标触边使 Dock 迁移；固定到启用时所在显示器",
    toggle: true,
    permission: "辅助功能",
  },
  {
    id: "shortcuts",
    label: "键指如飞",
    icon: Grid3X3,
    description: "显示前台应用菜单快捷键；双按并按住 ⌘ 可再次显示",
    permission: "辅助功能",
  },
  {
    id: "lowpower",
    label: "省电模式",
    icon: Zap,
    description: "直接切换电池和接电时的低电量模式；需要管理员授权",
    toggle: true,
    permission: "管理员",
  },
];
export const managementIcon = LayoutGrid;
export const defaultApps = [
  { id: "system-settings", label: "系统设置", icon: Settings },
  { id: "disk-utility", label: "磁盘工具", icon: HardDrive },
  { id: "system-information", label: "系统信息", icon: Info },
  { id: "privacy", label: "隐私与安全性", icon: Shield },
  { id: "activity-monitor", label: "活动监视器", icon: Activity },
];

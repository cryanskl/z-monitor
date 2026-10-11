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
  unsupported?: string;
}
export const features: Feature[] = [
  {
    id: "awake",
    label: "防止休眠",
    icon: Coffee,
    description: "阻止空闲休眠；合盖仍由 macOS 管理",
  },
  {
    id: "dark",
    label: "深色模式",
    icon: Contrast,
    description: "切换 macOS 的深色与浅色外观",
  },
  {
    id: "lock",
    label: "锁屏",
    icon: Monitor,
    description: "使用系统锁屏快捷键；首次使用需要辅助功能权限",
  },
  {
    id: "keep-display",
    label: "保持亮屏",
    icon: Monitor,
    description: "在锁定屏幕设置中调整显示器关闭时间",
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
    description: "临时禁用键盘输入",
    unsupported: "尚未接入系统键盘拦截权限",
  },
  {
    id: "desktop",
    label: "隐藏桌面文件",
    icon: Eye,
    description: "隐藏或显示桌面图标；Finder 会重新启动",
  },
  {
    id: "dock",
    label: "隐藏程序坞",
    icon: Dock,
    description: "切换 Dock 自动隐藏；Dock 会重新启动",
  },
  {
    id: "notch",
    label: "隐藏刘海儿",
    icon: Laptop,
    description: "调整刘海区域显示",
    unsupported: "尚未接入显示器分辨率控制",
  },
  {
    id: "menubar",
    label: "自动隐藏菜单栏",
    icon: PanelTop,
    description: "打开 macOS 菜单栏设置",
  },
  {
    id: "trash",
    label: "清倒废纸篓",
    icon: Trash2,
    description: "删除废纸篓中的文件",
    unsupported: "此版本不执行文件删除",
  },
  {
    id: "displays",
    label: "扩展监视器",
    icon: PanelsTopLeft,
    description: "打开显示器设置，连接与配置扩展屏幕",
  },
  {
    id: "lock-dock",
    label: "锁定 Dock",
    icon: AppWindow,
    description: "固定 Dock 所在的显示器",
    unsupported: "macOS 未提供对应公开接口",
  },
  {
    id: "shortcuts",
    label: "键指如飞",
    icon: Grid3X3,
    description: "显示当前应用快捷键",
    unsupported: "尚未接入跨应用辅助功能读取",
  },
  {
    id: "lowpower",
    label: "省电模式",
    icon: Zap,
    description: "打开 macOS 电池设置，调整低电量模式",
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

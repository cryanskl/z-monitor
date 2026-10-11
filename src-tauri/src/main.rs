#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

struct Monitor {
    snapshot: Arc<Mutex<Result<Value, String>>>,
    process: Mutex<Child>,
    awake: Mutex<Option<Child>>,
}

#[tauri::command]
fn get_snapshot(monitor: tauri::State<Monitor>) -> Result<Value, String> {
    monitor.snapshot.lock().unwrap().clone()
}

fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn quick_action(
    action: String,
    monitor: tauri::State<'_, Monitor>,
) -> Result<String, String> {
    match action.as_str() {
        "awake" => {
            let mut awake = monitor.awake.lock().unwrap();
            if let Some(mut child) = awake.take() {
                child.kill().map_err(|e| e.to_string())?;
                child.wait().map_err(|e| e.to_string())?;
                Ok("off".into())
            } else {
                *awake = Some(Command::new("/usr/bin/caffeinate").args(["-i", "-s"]).spawn().map_err(|e| e.to_string())?);
                Ok("on".into())
            }
        },
        "keep-display" => run("/usr/bin/osascript", &["-e", "tell application \"System Settings\" to activate", "-e", "open location \"x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension\""]),
        "dark" => run("/usr/bin/osascript", &["-e", "tell application \"System Events\" to tell appearance preferences to set dark mode to not dark mode"]),
        "lock" => run("/usr/bin/osascript", &["-e", "tell application \"System Events\" to keystroke \"q\" using {command down, control down}"]),
        "screensaver" => run("/usr/bin/open", &["-a", "/System/Library/CoreServices/ScreenSaverEngine.app"]),
        "desktop" => {
            let value = run("/usr/bin/osascript", &["-e", "tell application \"System Events\" to tell preferences file \"com.apple.finder\"\nif exists property list item \"CreateDesktop\" then\nreturn value of property list item \"CreateDesktop\"\nelse\nreturn true\nend if\nend tell"])?;
            let next = if value == "false" { "true" } else { "false" };
            run("/usr/bin/defaults", &["write", "com.apple.finder", "CreateDesktop", "-bool", next])?;
            run("/usr/bin/killall", &["Finder"])
        },
        "dock" => {
            let current = run("/usr/bin/defaults", &["read", "com.apple.dock", "autohide"])?;
            let next = if current == "1" { "false" } else { "true" };
            run("/usr/bin/defaults", &["write", "com.apple.dock", "autohide", "-bool", next])?;
            run("/usr/bin/killall", &["Dock"])
        },
        "menubar" => run("/usr/bin/open", &["x-apple.systempreferences:com.apple.ControlCenter-Settings.extension"]),
        "displays" => run("/usr/bin/open", &["x-apple.systempreferences:com.apple.Displays-Settings.extension"]),
        "lowpower" => run("/usr/bin/open", &["x-apple.systempreferences:com.apple.Battery-Settings.extension"]),
        "system-settings" => run("/usr/bin/open", &["-a", "System Settings"]),
        "disk-utility" => run("/usr/bin/open", &["-a", "Disk Utility"]),
        "system-information" => run("/usr/bin/open", &["-a", "System Information"]),
        "privacy" => run("/usr/bin/open", &["x-apple.systempreferences:com.apple.preference.security"]),
        "activity-monitor" => run("/usr/bin/open", &["-a", "Activity Monitor"]),
        "pick-app" => run("/usr/bin/osascript", &["-e", "POSIX path of (choose file with prompt \"选择快捷应用\" of type {\"com.apple.application-bundle\"})"]),
        _ => Err(format!("Unsupported action: {action}")),
    }
}

#[tauri::command]
fn open_application(path: &str) -> Result<String, String> {
    let app = std::path::Path::new(path.trim_end_matches('/'));
    if !app.is_absolute()
        || app.extension().and_then(|v| v.to_str()) != Some("app")
        || !app.is_dir()
    {
        return Err("请选择本机的 .app 应用".into());
    }
    run("/usr/bin/open", &["-a", path])
}

#[tauri::command]
fn awake_status(monitor: tauri::State<Monitor>) -> bool {
    monitor.awake.lock().unwrap().is_some()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let path = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/monitor")
            } else {
                app.path().resource_dir()?.join("binaries/monitor")
            };
            let mut child = Command::new(path)
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()?;
            let stdout = child.stdout.take().unwrap();
            let snapshot = Arc::new(Mutex::new(Err("正在读取系统数据…".into())));
            let state = snapshot.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let result = line
                        .map_err(|e| e.to_string())
                        .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()));
                    *state.lock().unwrap() = result;
                }
                *state.lock().unwrap() =
                    Err("系统采集进程已停止，请重新启动应用；具体错误见进程日志".into());
            });
            app.manage(Monitor {
                snapshot,
                process: Mutex::new(child),
                awake: Mutex::new(None),
            });
            let main = app.get_webview_window("main").unwrap();
            window_vibrancy::apply_vibrancy(
                &main,
                window_vibrancy::NSVisualEffectMaterial::HudWindow,
                None,
                Some(20.0),
            )?;
            let show = MenuItem::with_id(app, "show", "显示监控面板", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 z-monitor", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("monitor")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("z-monitor · 系统监控")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let win = app.get_webview_window("main").unwrap();
                        if let Err(e) = win.show().and_then(|_| win.set_focus()) {
                            eprintln!("{e}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let win = tray.app_handle().get_webview_window("main").unwrap();
                        let result = win.is_visible().and_then(|visible| {
                            if visible {
                                win.hide()
                            } else {
                                win.show().and_then(|_| win.set_focus())
                            }
                        });
                        if let Err(e) = result {
                            eprintln!("{e}");
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(e) = window.hide() {
                        eprintln!("{e}");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            quick_action,
            open_application,
            awake_status
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start z-monitor")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<Monitor>();
                let mut child = state.process.lock().unwrap();
                if let Err(e) = child.kill().and_then(|_| child.wait().map(|_| ())) {
                    eprintln!("Telemetry shutdown: {e}");
                }
                if let Some(mut awake) = state.awake.lock().unwrap().take() {
                    if let Err(e) = awake.kill().and_then(|_| awake.wait().map(|_| ())) {
                        eprintln!("Caffeinate shutdown: {e}");
                    }
                };
            }
        });
}

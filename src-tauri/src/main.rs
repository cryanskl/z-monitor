#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::{
    ffi::{CStr, CString},
    io::{BufRead, BufReader, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

extern "C" {
    fn z_action(json: *const libc::c_char) -> *mut libc::c_char;
    fn z_free(string: *mut libc::c_char);
}

struct Monitor {
    snapshot: Arc<Mutex<Result<Value, String>>>,
    process: Mutex<Child>,
    fan_helper: PathBuf,
    fan_session: Mutex<Option<FanSession>>,
}

struct FanSession {
    stream: BufReader<UnixStream>,
    directory: PathBuf,
}
impl Drop for FanSession {
    fn drop(&mut self) {
        if let Err(e) = self.stream.get_ref().shutdown(std::net::Shutdown::Both) {
            eprintln!("Fan shutdown: {e}");
        }
        if let Err(e) = std::fs::remove_file(self.directory.join("control.sock")) {
            eprintln!("Fan socket cleanup: {e}");
        }
        if let Err(e) = std::fs::remove_dir(&self.directory) {
            eprintln!("Fan directory cleanup: {e}");
        }
    }
}
impl Monitor {
    fn native_action(&self, request: Value) -> Result<Value, String> {
        let input = CString::new(request.to_string()).map_err(|e| e.to_string())?;
        unsafe {
            let ptr = z_action(input.as_ptr());
            let response = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            z_free(ptr);
            let data: Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
            if data["ok"] == true {
                Ok(data["value"].clone())
            } else {
                Err(data["error"].as_str().unwrap().into())
            }
        }
    }
    fn start_fan_session(&self) -> Result<FanSession, String> {
        let directory = PathBuf::from("/tmp").join(format!(
            "zm-fan-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        let socket = directory.join("control.sock");
        let listener = UnixListener::bind(&socket).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let shell_quote = |value: &str| format!("'{}'", value.replace('\'', "'\"'\"'"));
        let command = format!(
            "{} --session {} {} {}",
            shell_quote(self.fan_helper.to_str().unwrap()),
            std::process::id(),
            unsafe { libc::getuid() },
            shell_quote(socket.to_str().unwrap())
        );
        let script = format!(
            "do shell script {} with administrator privileges",
            serde_json::to_string(&command).unwrap()
        );
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = run("/usr/bin/osascript", &["-e", &script]);
            if let Err(ref error) = result {
                eprintln!("Fan administrator session: {error}");
            }
            let _ = sender.send(result);
        });
        let start = Instant::now();
        let accepted = loop {
            match listener.accept() {
                Ok((stream, _)) => break Ok(stream),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => break Err(e.to_string()),
            }
            if let Ok(result) = receiver.try_recv() {
                break Err(result.err().unwrap_or_else(|| "风扇会话提前退出".into()));
            }
            if start.elapsed() > Duration::from_secs(120) {
                break Err("管理员授权等待超时，请重新点击设置转速".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        drop(listener);
        match accepted {
            Ok(stream) => {
                stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                let mut uid = 0;
                let mut gid = 0;
                use std::os::fd::AsRawFd;
                if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0
                    || uid != 0
                {
                    return Err("风扇 helper 未以管理员身份连接".into());
                }
                stream
                    .set_read_timeout(Some(Duration::from_secs(45)))
                    .map_err(|e| e.to_string())?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .map_err(|e| e.to_string())?;
                let mut session = FanSession {
                    stream: BufReader::new(stream),
                    directory,
                };
                read_fan_response(&mut session)?;
                Ok(session)
            }
            Err(error) => {
                std::fs::remove_file(&socket).map_err(|e| e.to_string())?;
                std::fs::remove_dir(&directory).map_err(|e| e.to_string())?;
                Err(format!("管理员授权未完成：{error}"))
            }
        }
    }
}
fn read_fan_response(session: &mut FanSession) -> Result<Value, String> {
    let mut response = String::new();
    let length = session
        .stream
        .read_line(&mut response)
        .map_err(|e| e.to_string())?;
    if length == 0 {
        return Err("风扇控制会话已断开，请重新授权".into());
    }
    let value: Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
    if value["ok"] == true {
        Ok(value["value"].clone())
    } else {
        Err(value["error"].as_str().unwrap().into())
    }
}
#[tauri::command]
async fn native_action(
    request: Value,
    monitor: tauri::State<'_, Monitor>,
) -> Result<Value, String> {
    monitor.native_action(request)
}
#[tauri::command]
async fn action_status(monitor: tauri::State<'_, Monitor>) -> Result<Value, String> {
    let mut status = monitor.native_action(serde_json::json!({"action": "status"}))?;
    let power = run("/usr/bin/pmset", &["-g", "custom"])?;
    status["lowpower"] = Value::Bool(power.lines().any(|line| {
        let fields: Vec<_> = line.split_whitespace().collect();
        fields == ["powermode", "1"] || fields == ["lowpowermode", "1"]
    }));
    Ok(status)
}
#[tauri::command]
async fn set_fan(
    id: u32,
    rpm: Option<f64>,
    monitor: tauri::State<'_, Monitor>,
) -> Result<Value, String> {
    let mut state = monitor.fan_session.lock().unwrap();
    if state.is_none() {
        *state = Some(monitor.start_fan_session()?);
    }
    let session = state.as_mut().unwrap();
    let request = serde_json::json!({"id": id, "rpm": rpm}).to_string() + "\n";
    if let Err(e) = session.stream.get_mut().write_all(request.as_bytes()) {
        state.take();
        return Err(e.to_string());
    }
    let result = read_fan_response(session);
    if result.is_err() {
        state.take();
    }
    result
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
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("{program} 未完成：{}", output.status)
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn quick_action(
    action: String,
    monitor: tauri::State<'_, Monitor>,
) -> Result<String, String> {
    match action.as_str() {
        "lock" | "awake" | "keep-display" | "desktop" | "dock" | "menubar" | "displays" | "notch" | "lock-dock" | "shortcuts" | "clean-screen" | "clean-keyboard" => Ok(monitor.native_action(serde_json::json!({"action": action}))?.to_string()),
        "dark" => run("/usr/bin/osascript", &["-e", "tell application \"System Events\" to tell appearance preferences to set dark mode to not dark mode"]),
        "screensaver" => run("/usr/bin/open", &["-a", "/System/Library/CoreServices/ScreenSaverEngine.app"]),
        "trash" => {
            if monitor.native_action(serde_json::json!({"action": "confirm-trash"}))? != true { return Ok("cancelled".into()); }
            run("/usr/bin/osascript", &["-e", "tell application \"Finder\" to empty trash"])
        },
        "lowpower" => {
            let current = run("/usr/bin/pmset", &["-g", "custom"])?;
            let on = current.lines().any(|line| { let parts: Vec<_> = line.split_whitespace().collect(); parts == ["powermode", "1"] || parts == ["lowpowermode", "1"] });
            let command = format!("/usr/bin/pmset -a lowpowermode {}", if on {0} else {1});
            let script = format!("do shell script {} with administrator privileges", serde_json::to_string(&command).unwrap());
            run("/usr/bin/osascript", &["-e", &script])?;
            let readback = run("/usr/bin/pmset", &["-g", "custom"])?;
            let modes: Vec<_> = readback.lines().filter_map(|line| { let parts: Vec<_> = line.split_whitespace().collect(); if parts.len() == 2 && ["powermode", "lowpowermode"].contains(&parts[0]) {Some(parts[1])} else {None} }).collect();
            if modes.is_empty() || !modes.iter().all(|value| *value == if on {"0"} else {"1"}) { return Err("省电模式设置未生效，请检查这台 Mac 是否支持低电量模式".into()); }
            Ok(if on {"off"} else {"on"}.into())
        },
        "purge" => run("/usr/bin/osascript", &["-e", "do shell script \"/usr/sbin/purge\" with administrator privileges"]),
        "system-settings" => run("/usr/bin/open", &["-a", "System Settings"]),
        "disk-utility" => run("/usr/bin/open", &["-a", "Disk Utility"]),
        "system-information" => run("/usr/bin/open", &["-a", "System Information"]),
        "privacy" => run("/usr/bin/open", &["x-apple.systempreferences:com.apple.preference.security"]),
        "activity-monitor" => run("/usr/bin/open", &["-a", "Activity Monitor"]),
        "pick-app" => Ok(monitor.native_action(serde_json::json!({"action": "pick-app"}))?.as_str().unwrap().into()),
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let path = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/monitor")
            } else {
                app.path().resource_dir()?.join("binaries/monitor")
            };
            let binaries = path.parent().unwrap();
            std::env::set_var("Z_MONITOR_NATIVE_DIR", binaries);
            let fan_helper = binaries.join("fan-control");
            let mut child = Command::new(&path)
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
                fan_helper,
                fan_session: Mutex::new(None),
            });
            app.state::<Monitor>()
                .native_action(serde_json::json!({"action": "status"}))
                .map_err(std::io::Error::other)?;
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
            native_action,
            set_fan,
            action_status
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start z-monitor")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<Monitor>();
                if let Err(e) = state.native_action(serde_json::json!({"action": "shutdown"})) {
                    eprintln!("Native shutdown: {e}");
                }
                if let Ok(mut session) = state.fan_session.try_lock() {
                    session.take();
                }
                let mut child = state.process.lock().unwrap();
                if let Err(e) = child.kill().and_then(|_| child.wait().map(|_| ())) {
                    eprintln!("Telemetry shutdown: {e}");
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::run;
    #[test]
    fn failed_process_without_stderr_still_explains_failure() {
        let error = run("/usr/bin/false", &[]).unwrap_err();
        assert!(error.contains("/usr/bin/false"));
        assert!(error.contains("exit status"));
    }
}

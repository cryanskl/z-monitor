fn main() {
    std::fs::create_dir_all("binaries").expect("Unable to create native binary directory");
    println!("cargo:rerun-if-changed=../native/Monitor.swift");
    let target = std::env::var("TARGET").unwrap();
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let swift_target = format!("{arch}-apple-macos13.0");
    let status = std::process::Command::new("/usr/bin/xcrun")
        .args([
            "swiftc",
            "-O",
            "-target",
            &swift_target,
            "../native/Monitor.swift",
            "-o",
            "binaries/monitor",
            "-framework",
            "IOKit",
        ])
        .status()
        .expect("Xcode Command Line Tools are required");
    assert!(status.success(), "Native telemetry compilation failed");
    tauri_build::build();
}

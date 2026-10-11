fn main() {
    std::fs::create_dir_all("binaries").expect("Unable to create native binary directory");
    for source in [
        "SMC.swift",
        "main.swift",
        "Actions.swift",
        "FanControl.swift",
        "PowerControl.swift",
    ] {
        println!("cargo:rerun-if-changed=../native/{source}");
    }
    let target = std::env::var("TARGET").unwrap();
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let swift_target = format!("{arch}-apple-macos13.0");
    for (sources, output, extra) in [
        (
            vec!["../native/SMC.swift", "../native/main.swift"],
            "binaries/monitor",
            vec!["-framework", "IOKit"],
        ),
        (
            vec!["../native/Actions.swift"],
            "binaries/libzmonitor_native.a",
            vec![
                "-emit-library",
                "-static",
                "-framework",
                "AppKit",
                "-framework",
                "ApplicationServices",
            ],
        ),
        (
            vec!["../native/SMC.swift", "../native/FanControl.swift"],
            "binaries/fan-control",
            vec!["-framework", "IOKit"],
        ),
        (
            vec!["../native/PowerControl.swift"],
            "binaries/power-control",
            vec!["-parse-as-library", "-framework", "IOKit"],
        ),
    ] {
        let status = std::process::Command::new("/usr/bin/xcrun")
            .args(["swiftc", "-O", "-target", &swift_target])
            .args(sources)
            .args(["-o", output])
            .args(extra)
            .status()
            .expect("Xcode Command Line Tools are required");
        assert!(status.success(), "Native compilation failed: {output}");
    }
    println!(
        "cargo:rustc-link-search=native={}/binaries",
        std::env::var("CARGO_MANIFEST_DIR").unwrap()
    );
    println!("cargo:rustc-link-lib=static=zmonitor_native");
    let sdk = std::process::Command::new("/usr/bin/xcrun")
        .arg("--show-sdk-path")
        .output()
        .unwrap();
    let sdk_path = String::from_utf8(sdk.stdout).unwrap();
    println!(
        "cargo:rustc-link-search=native={}/usr/lib/swift",
        sdk_path.trim()
    );
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    let compiler = std::process::Command::new("/usr/bin/xcrun")
        .args(["-f", "swiftc"])
        .output()
        .unwrap();
    let compiler_path =
        std::path::PathBuf::from(String::from_utf8(compiler.stdout).unwrap().trim());
    println!(
        "cargo:rustc-link-search=native={}",
        compiler_path
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("lib/swift/macosx")
            .display()
    );
    tauri_build::build();
}

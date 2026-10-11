#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src-tauri/binaries
xcrun swiftc -O -target "$(uname -m)-apple-macos13.0" native/SMC.swift native/main.swift -o src-tauri/binaries/monitor -framework IOKit

xcrun swiftc -O -target "$(uname -m)-apple-macos13.0" -emit-library native/Actions.swift -o src-tauri/binaries/libactions.dylib -framework AppKit -framework ApplicationServices
xcrun swiftc -O -target "$(uname -m)-apple-macos13.0" native/SMC.swift native/FanControl.swift -o src-tauri/binaries/fan-control -framework IOKit

xcrun swiftc -O -target "$(uname -m)-apple-macos13.0" -emit-library -static native/Actions.swift -o src-tauri/binaries/libzmonitor_native.a -framework AppKit -framework ApplicationServices

xcrun swiftc -O -target "$(uname -m)-apple-macos13.0" -parse-as-library native/PowerControl.swift -o src-tauri/binaries/power-control -framework IOKit

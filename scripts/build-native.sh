#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src-tauri/binaries
xcrun swiftc -O -target "$(uname -m)-apple-macos13.0" native/Monitor.swift -o src-tauri/binaries/monitor -framework IOKit

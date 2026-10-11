import AppKit
import ApplicationServices
import Darwin
import IOKit.pwr_mgt

struct ActionFailure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}

final class CleaningWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override func keyDown(with event: NSEvent) {
    if event.keyCode == 53 && !Actions.shared.keyboardBlocked { Actions.shared.stopCleaning() }
  }
}
final class CleaningView: NSView {
  var stop: (() -> Void)!
  override func mouseDown(with event: NSEvent) { stop() }
}
final class Actions {
  static let shared = Actions()
  var awake: Process?
  var awakeInput: Pipe?
  var awakeErrors: Pipe?
  var keepDisplay: IOPMAssertionID = 0
  var cleaning: [NSWindow] = []
  var cleaningTimer: Timer?
  var cleaningUntil: Date?
  var keyboardBlocked = false
  var notchWindows: [NSWindow] = []
  var dockScreen: CGDirectDisplayID?
  var eventTap: CFMachPort?
  var eventSource: CFRunLoopSource?
  var previousApp: NSRunningApplication?
  var shortcutsEnabled = false
  var shortcutsWindow: NSPanel?
  var commandPressed = false
  var lastCommand: TimeInterval = 0
  var hotkeys: [String: Int] = [:]
  var notification: NSObjectProtocol?
  var screensNotification: NSObjectProtocol?
  init() {
    let app = NSWorkspace.shared.frontmostApplication
    if app?.processIdentifier != getpid() { previousApp = app }
    notification = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      if app?.processIdentifier != getpid() { self?.previousApp = app }
    }
    screensNotification = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      if !self.notchWindows.isEmpty {
        self.hideNotch()
        self.showNotch()
      }
      if let id = self.dockScreen, !NSScreen.screens.contains(where: { self.screenID($0) == id }) {
        self.dockScreen = nil
      }
      if !self.cleaning.isEmpty { self.stopCleaning() }
    }
  }
  func screenID(_ screen: NSScreen) -> CGDirectDisplayID {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! NSNumber).uint32Value
  }
  func preference(_ domain: String, _ key: String) -> CFPropertyList? {
    let app = domain == "NSGlobalDomain" ? kCFPreferencesAnyApplication : domain as CFString
    CFPreferencesSynchronize(app, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
    return CFPreferencesCopyValue(
      key as CFString, app, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
  }
  func boolPreference(_ domain: String, _ key: String, default fallback: Bool) -> Bool {
    return (preference(domain, key) as? NSNumber)?.boolValue ?? fallback
  }
  func writePreference(_ domain: String, _ key: String, _ value: Any) throws {
    let app = domain == "NSGlobalDomain" ? kCFPreferencesAnyApplication : domain as CFString
    CFPreferencesSetValue(
      key as CFString, value as CFPropertyList, app, kCFPreferencesCurrentUser,
      kCFPreferencesAnyHost)
    guard CFPreferencesSynchronize(app, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) else {
      throw ActionFailure("无法保存系统设置 \(domain)/\(key)")
    }
  }
  func execute(_ executable: String, _ args: [String]) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = args
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    let error = errors.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      throw ActionFailure(
        String(decoding: error, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
  }
  func ensureAccessibility() throws {
    guard AXIsProcessTrusted() else {
      throw ActionFailure("需要辅助功能权限：系统设置 → 隐私与安全性 → 辅助功能 → 开启 z-monitor，然后重试。")
    }
  }
  func ensureTap() throws {
    try ensureAccessibility()
    if eventTap != nil { return }
    let mask = [
      CGEventType.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseDragged,
      .rightMouseDragged,
    ].reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
    guard
      let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
        eventsOfInterest: mask,
        callback: { _, type, event, _ in
          let actions = Actions.shared
          if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap = actions.eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
          }
          if actions.keyboardBlocked
            && (type == .keyDown || type == .keyUp || type == .flagsChanged)
          {
            return nil
          }
          if type == .keyDown {
            let flags = event.flags.intersection([
              .maskControl, .maskAlternate, .maskCommand, .maskShift,
            ])
            if flags == [.maskControl, .maskAlternate, .maskCommand],
              let action = actions.hotkeys.first(where: {
                $0.value == Int(event.getIntegerValueField(.keyboardEventKeycode))
              })?.key
            {
              DispatchQueue.main.async {
                do { _ = try actions.perform(["action": action]) } catch {
                  actions.showError(String(describing: error))
                }
              }
              return nil
            }
          }
          if type == .flagsChanged && actions.shortcutsEnabled {
            let down = event.flags.contains(.maskCommand)
            if down && !actions.commandPressed {
              let now = ProcessInfo.processInfo.systemUptime
              if now - actions.lastCommand < 0.5 {
                DispatchQueue.main.async {
                  do { try actions.showShortcuts() } catch {
                    actions.showError(String(describing: error))
                  }
                }
              }
              actions.lastCommand = now
            }
            if !down { actions.shortcutsWindow?.orderOut(nil) }
            actions.commandPressed = down
          }
          if let allowed = actions.dockScreen,
            [.mouseMoved, .leftMouseDragged, .rightMouseDragged].contains(type)
          {
            var point = event.location
            let orientation =
              UserDefaults(suiteName: "com.apple.dock")?.string(forKey: "orientation") ?? "bottom"
            for screen in NSScreen.screens where actions.screenID(screen) != allowed {
              let bounds = CGDisplayBounds(actions.screenID(screen))
              guard bounds.contains(point) else { continue }
              if orientation == "left" && point.x < bounds.minX + 3 {
                point.x = bounds.minX + 5
              } else if orientation == "right" && point.x > bounds.maxX - 3 {
                point.x = bounds.maxX - 5
              } else if orientation == "bottom" && point.y > bounds.maxY - 3 {
                point.y = bounds.maxY - 5
              }
              event.location = point
            }
          }
          return Unmanaged.passUnretained(event)
        }, userInfo: nil)
    else { throw ActionFailure("无法创建输入拦截，请检查辅助功能权限并重新启动 z-monitor。") }
    eventTap = tap
    eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
  }
  func stopCleaning() {
    keyboardBlocked = false
    cleaningTimer?.invalidate()
    cleaningTimer = nil
    cleaningUntil = nil
    for window in cleaning { window.orderOut(nil) }
    cleaning = []
  }
  func clean(_ keyboard: Bool, seconds: Double) throws {
    if !cleaning.isEmpty {
      stopCleaning()
      return
    }
    if keyboard { try ensureTap() }
    keyboardBlocked = keyboard
    cleaningUntil = Date().addingTimeInterval(seconds)
    for screen in NSScreen.screens {
      let window = CleaningWindow(
        contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.backgroundColor = .black
      window.level = .screenSaver
      window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
      window.hasShadow = false
      let view = CleaningView(frame: NSRect(origin: .zero, size: screen.frame.size))
      view.stop = { [weak self] in self?.stopCleaning() }
      let title = NSTextField(labelWithString: keyboard ? "键盘已锁定 · 点击屏幕退出" : "清洁屏幕 · 点击屏幕或按 Esc 退出")
      title.textColor = .white
      title.font = .systemFont(ofSize: 18)
      title.alignment = .center
      title.frame = NSRect(x: 0, y: screen.frame.height / 2, width: screen.frame.width, height: 30)
      view.addSubview(title)
      let remaining = NSTextField(labelWithString: "")
      remaining.textColor = .gray
      remaining.alignment = .center
      remaining.frame = NSRect(
        x: 0, y: screen.frame.height / 2 - 32, width: screen.frame.width, height: 24)
      view.addSubview(remaining)
      window.contentView = view
      window.makeKeyAndOrderFront(nil)
      cleaning.append(window)
      NSApp.activate(ignoringOtherApps: true)
    }
    cleaningTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, let until = self.cleaningUntil else { return }
      let remaining = Int(ceil(until.timeIntervalSinceNow))
      if remaining <= 0 {
        self.stopCleaning()
        return
      }
      for window in self.cleaning {
        (window.contentView!.subviews[1] as! NSTextField).stringValue = "\(remaining) 秒后自动退出"
      }
    }
  }
  func showNotch() {
    for screen in NSScreen.screens where screen.safeAreaInsets.top > 0 {
      let height = screen.safeAreaInsets.top
      let rect = NSRect(
        x: screen.frame.minX, y: screen.frame.maxY - height, width: screen.frame.width,
        height: height)
      let window = NSWindow(
        contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.backgroundColor = .black
      window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.backstopMenu)))
      window.ignoresMouseEvents = true
      window.hasShadow = false
      window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
      window.orderFrontRegardless()
      notchWindows.append(window)
    }
  }
  func hideNotch() {
    for window in notchWindows { window.orderOut(nil) }
    notchWindows = []
  }
  func attribute(_ element: AXUIElement, _ name: String) throws -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    if error == .noValue || error == .attributeUnsupported { return nil }
    guard error == .success else {
      throw ActionFailure("读取应用菜单失败：\(name) (\(error.rawValue))。请检查权限或目标应用是否响应。")
    }
    return value
  }
  func shortcuts() throws -> (String, [String]) {
    try ensureAccessibility()
    let front = NSWorkspace.shared.frontmostApplication!
    let app = front.processIdentifier == getpid() ? previousApp : front
    guard let app, !app.isTerminated else { throw ActionFailure("请先切换到需要查看快捷键的应用，再打开键指如飞。") }
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(ax, 2)
    guard let menu = try attribute(ax, kAXMenuBarAttribute) else {
      throw ActionFailure("\(app.localizedName ?? "该应用") 没有提供可读取的菜单栏。")
    }
    var rows: [String] = []
    func visit(_ element: AXUIElement, _ parent: String, _ depth: Int) throws {
      guard depth < 12, rows.count < 1000 else { return }
      let title = try attribute(element, kAXTitleAttribute) as? String ?? ""
      let path = title.isEmpty ? parent : parent.isEmpty ? title : "\(parent) → \(title)"
      let char = try attribute(element, kAXMenuItemCmdCharAttribute) as? String ?? ""
      let virtual = try attribute(element, kAXMenuItemCmdVirtualKeyAttribute) as? NSNumber
      let specials = [
        36: "↩", 48: "⇥", 49: "空格", 51: "⌫", 53: "Esc", 123: "←", 124: "→", 125: "↓", 126: "↑",
      ]
      let key = char.isEmpty ? virtual.flatMap { specials[$0.intValue] } ?? "" : char.uppercased()
      if !key.isEmpty {
        let modifiers =
          (try attribute(element, kAXMenuItemCmdModifiersAttribute) as? NSNumber)?.intValue ?? 0
        let flags =
          (modifiers & 4 != 0 ? "⌃" : "") + (modifiers & 2 != 0 ? "⌥" : "")
          + (modifiers & 1 != 0 ? "⇧" : "") + (modifiers & 8 == 0 ? "⌘" : "")
        rows.append("\(flags)\(key)    \(path)")
      }
      if let children = try attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        for child in children { try visit(child, path, depth + 1) }
      }
    }
    try visit(unsafeBitCast(menu, to: AXUIElement.self), "", 0)
    return (app.localizedName ?? "应用", rows)
  }
  func showShortcuts() throws {
    let (app, rows) = try shortcuts()
    if let window = shortcutsWindow { window.orderOut(nil) }
    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 720, height: 520),
      styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isReleasedWhenClosed = false
    panel.title = "\(app) · 快捷键（双按并按住 ⌘ 显示，松开隐藏）"
    panel.level = .floating
    let scroll = NSScrollView(frame: panel.contentView!.bounds)
    scroll.autoresizingMask = [.width, .height]
    scroll.hasVerticalScroller = true
    let text = NSTextView(frame: scroll.bounds)
    text.isEditable = false
    text.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
    text.string = rows.isEmpty ? "该应用没有向辅助功能接口公开菜单快捷键。" : rows.joined(separator: "\n\n")
    text.textContainerInset = NSSize(width: 20, height: 20)
    text.isVerticallyResizable = true
    text.autoresizingMask = [.width]
    text.textContainer!.widthTracksTextView = true
    scroll.documentView = text
    panel.contentView!.addSubview(scroll)
    panel.center()
    panel.orderFrontRegardless()
    shortcutsWindow = panel
  }
  func showError(_ text: String) {
    let alert = NSAlert()
    alert.messageText = "z-monitor"
    alert.informativeText = text
    alert.runModal()
  }
  func status() -> [String: Any] {
    return [
      "awake": awake?.isRunning == true,
      "dark": (preference("NSGlobalDomain", "AppleInterfaceStyle") as? String) == "Dark",
      "keep-display": keepDisplay != 0,
      "desktop": !boolPreference("com.apple.finder", "CreateDesktop", default: true),
      "dock": boolPreference("com.apple.dock", "autohide", default: false),
      "menubar": boolPreference("NSGlobalDomain", "_HIHideMenuBar", default: false),
      "notch": !notchWindows.isEmpty, "lock-dock": dockScreen != nil, "shortcuts": shortcutsEnabled,
      "clean-keyboard": keyboardBlocked, "accessibility": AXIsProcessTrusted(),
      "displays": NSScreen.screens.count,
    ]
  }
  func perform(_ request: [String: Any]) throws -> Any {
    let action = request["action"] as! String
    switch action {
    case "status": return status()
    case "lock":
      guard
        let framework = dlopen("/System/Library/PrivateFrameworks/login.framework/login", RTLD_LAZY)
      else { throw ActionFailure("当前 macOS 无法加载系统锁屏接口") }
      defer { dlclose(framework) }
      guard let symbol = dlsym(framework, "SACLockScreenImmediate") else {
        throw ActionFailure("当前 macOS 不提供系统锁屏接口")
      }
      typealias Lock = @convention(c) () -> Int32
      let result = unsafeBitCast(symbol, to: Lock.self)()
      guard result == 0 else { throw ActionFailure("系统锁屏请求失败：\(result)") }
      return true
    case "permission":
      _ = AXIsProcessTrustedWithOptions(
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
      _ = try execute(
        "/usr/bin/open",
        ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"])
      return status()
    case "awake":
      if let process = awake {
        awakeInput!.fileHandleForWriting.closeFile()
        process.waitUntilExit()
        let error = awakeErrors!.fileHandleForReading.readDataToEndOfFile()
        awake = nil
        awakeInput = nil
        awakeErrors = nil
        guard error.isEmpty else { throw ActionFailure(String(decoding: error, as: UTF8.self)) }
      } else {
        let process = Process()
        process.executableURL = URL(
          fileURLWithPath: ProcessInfo.processInfo.environment["Z_MONITOR_NATIVE_DIR"]!
        ).appendingPathComponent("power-control")
        let input = Pipe()
        let output = Pipe()
        let errors = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        let ready = output.fileHandleForReading.availableData
        guard
          String(decoding: ready, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            == "ready"
        else {
          input.fileHandleForWriting.closeFile()
          process.waitUntilExit()
          throw ActionFailure(
            String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self))
        }
        awake = process
        awakeInput = input
        awakeErrors = errors
      }
      return status()
    case "keep-display":
      if keepDisplay != 0 {
        let result = IOPMAssertionRelease(keepDisplay)
        guard result == kIOReturnSuccess else { throw ActionFailure("释放亮屏请求失败 \(result)") }
        keepDisplay = 0
      } else {
        let result = IOPMAssertionCreateWithName(
          kIOPMAssertionTypeNoDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
          "z-monitor display awake" as CFString, &keepDisplay)
        guard result == kIOReturnSuccess else { throw ActionFailure("保持亮屏失败 \(result)") }
      }
      return status()
    case "desktop", "dock", "menubar":
      let domain =
        action == "desktop"
        ? "com.apple.finder" : action == "dock" ? "com.apple.dock" : "NSGlobalDomain"
      let key =
        action == "desktop" ? "CreateDesktop" : action == "dock" ? "autohide" : "_HIHideMenuBar"
      let value = !boolPreference(domain, key, default: action == "desktop")
      try writePreference(domain, key, value)
      if action == "menubar" {
        try writePreference("com.apple.controlcenter", "AutoHideMenuBarOption", value ? 0 : 3)
        DistributedNotificationCenter.default().postNotificationName(
          NSNotification.Name("AppleInterfaceMenuBarHidingChangedNotification"), object: nil)
      } else {
        _ = try execute("/usr/bin/killall", [action == "desktop" ? "Finder" : "Dock"])
      }
      guard boolPreference(domain, key, default: !value) == value else {
        throw ActionFailure("设置读回失败")
      }
      return status()
    case "clean-keyboard", "clean-screen":
      let seconds = request["seconds"] as? Double ?? 60
      guard seconds >= 1, seconds <= 300 else { throw ActionFailure("清洁时间应在 1–300 秒内") }
      try clean(action == "clean-keyboard", seconds: seconds)
      return status()
    case "stop-cleaning":
      stopCleaning()
      return status()
    case "notch":
      if !notchWindows.isEmpty {
        hideNotch()
      } else {
        showNotch()
        guard !notchWindows.isEmpty else { throw ActionFailure("当前连接的显示器没有刘海区域。") }
      }
      return status()
    case "lock-dock":
      if dockScreen != nil {
        dockScreen = nil
      } else {
        try ensureTap()
        var dock = CGRect.zero
        if let library = dlopen(
          "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", RTLD_LAZY),
          let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CoreDockGetRect")
        {
          defer { dlclose(library) }
          typealias GetRect = @convention(c) (UnsafeMutablePointer<CGRect>) -> Void
          unsafeBitCast(symbol, to: GetRect.self)(&dock)
        } else {
          throw ActionFailure("当前 macOS 无法读取 Dock 所在的显示器。")
        }
        guard
          let screen = NSScreen.screens.first(where: {
            CGDisplayBounds(screenID($0)).intersects(dock)
          })
        else { throw ActionFailure("无法定位 Dock，请先将鼠标移到 Dock 使它显示后重试。") }
        dockScreen = screenID(screen)
      }
      return status()
    case "shortcuts":
      try ensureTap()
      try showShortcuts()
      shortcutsEnabled = true
      return status()
    case "shortcuts-enable":
      try ensureTap()
      shortcutsEnabled = true
      return status()
    case "shortcuts-off":
      shortcutsEnabled = false
      shortcutsWindow?.orderOut(nil)
      return status()
    case "configure-hotkeys":
      let choices = request["hotkeys"] as? [String: Int] ?? [:]
      guard choices.keys.allSatisfy({ ["awake", "keep-display", "lock-dock"].contains($0) }),
        choices.values.allSatisfy({ [0, 2, 37].contains($0) }),
        Set(choices.values).count == choices.count
      else { throw ActionFailure("快捷键配置无效或重复") }
      if !choices.isEmpty { try ensureTap() }
      hotkeys = choices
      return status()
    case "displays":
      var ids = [CGDirectDisplayID](repeating: 0, count: 32)
      var count: UInt32 = 0
      guard CGGetOnlineDisplayList(32, &ids, &count) == .success else {
        throw ActionFailure("无法枚举显示器")
      }
      let displays = Array(ids.prefix(Int(count)))
      guard displays.count > 1 else { throw ActionFailure("请先连接外接显示器；无线显示器可在系统显示器设置中添加。") }
      let mirrored = displays.filter { $0 != CGMainDisplayID() && CGDisplayIsInMirrorSet($0) != 0 }
      if mirrored.isEmpty { return status() }
      var config: CGDisplayConfigRef?
      guard CGBeginDisplayConfiguration(&config) == .success else {
        throw ActionFailure("无法开始显示器配置")
      }
      var x = Int32(CGDisplayBounds(CGMainDisplayID()).width)
      for id in mirrored {
        let mirror = CGConfigureDisplayMirrorOfDisplay(config, id, kCGNullDirectDisplay)
        let origin = CGConfigureDisplayOrigin(config, id, x, 0)
        guard mirror == .success, origin == .success else {
          CGCancelDisplayConfiguration(config)
          throw ActionFailure("扩展显示器配置失败 \(mirror.rawValue)/\(origin.rawValue)")
        }
        x += Int32(CGDisplayBounds(id).width)
      }
      guard CGCompleteDisplayConfiguration(config, .forSession) == .success else {
        throw ActionFailure("无法应用扩展显示器配置")
      }
      return status()
    case "confirm-trash":
      let alert = NSAlert()
      alert.messageText = "清倒废纸篓？"
      alert.informativeText = "将永久删除废纸篓中的所有项目，无法撤销。"
      alert.alertStyle = .warning
      alert.addButton(withTitle: "取消")
      alert.addButton(withTitle: "清倒废纸篓")
      return alert.runModal() == .alertSecondButtonReturn
    case "pick-app":
      let panel = NSOpenPanel()
      panel.title = "选择快捷应用"
      panel.allowedContentTypes = [.applicationBundle]
      panel.canChooseDirectories = false
      panel.allowsMultipleSelection = false
      panel.directoryURL = URL(fileURLWithPath: "/Applications")
      return panel.runModal() == .OK ? panel.url!.path : ""
    case "shutdown":
      stopCleaning()
      hideNotch()
      shortcutsWindow?.orderOut(nil)
      if let process = awake {
        awakeInput!.fileHandleForWriting.closeFile()
        process.waitUntilExit()
        let error = awakeErrors!.fileHandleForReading.readDataToEndOfFile()
        awake = nil
        awakeInput = nil
        awakeErrors = nil
        guard error.isEmpty else { throw ActionFailure(String(decoding: error, as: UTF8.self)) }
      }
      if keepDisplay != 0 {
        IOPMAssertionRelease(keepDisplay)
        keepDisplay = 0
      }
      if let tap = eventTap {
        CGEvent.tapEnable(tap: tap, enable: false)
        CFMachPortInvalidate(tap)
      }
      dockScreen = nil
      return true
    default: throw ActionFailure("Unknown native action: \(action)")
    }
  }
}

@_cdecl("z_action") public func zAction(_ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
{
  let input = String(cString: json)
  var result = ""
  let perform = {
    do {
      guard
        let request = try JSONSerialization.jsonObject(with: Data(input.utf8)) as? [String: Any],
        request["action"] is String
      else { throw ActionFailure("Invalid action request") }
      let value = try Actions.shared.perform(request)
      let data = try JSONSerialization.data(
        withJSONObject: ["ok": true, "value": value], options: [.sortedKeys])
      result = String(decoding: data, as: UTF8.self)
    } catch {
      let data = try! JSONSerialization.data(withJSONObject: [
        "ok": false, "error": String(describing: error),
      ])
      result = String(decoding: data, as: UTF8.self)
    }
  }
  if Thread.isMainThread { perform() } else { DispatchQueue.main.sync(execute: perform) }
  return strdup(result)!
}
@_cdecl("z_free") public func zFree(_ string: UnsafeMutablePointer<CChar>) { free(string) }

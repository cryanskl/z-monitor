import AppKit
import Darwin
import IOKit

// Runs the shipped Swift operation layer on a real AppKit main thread.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let library = dlopen(CommandLine.arguments[1], RTLD_NOW)!
typealias Action = @convention(c) (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>
typealias Release = @convention(c) (UnsafeMutablePointer<CChar>) -> Void
let action = unsafeBitCast(dlsym(library, "z_action")!, to: Action.self)
let release = unsafeBitCast(dlsym(library, "z_free")!, to: Release.self)
let requests =
  try JSONSerialization.jsonObject(with: Data(CommandLine.arguments[2].utf8)) as! [[String: Any]]
for request in requests {
  if let wait = request["wait"] as? Double {
    RunLoop.main.run(until: Date().addingTimeInterval(wait))
    continue
  }
  if request["inspect-power"] as? Bool == true {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
    process.arguments = ["-g", "assertions"]
    let pipe = Pipe()
    process.standardOutput = pipe
    try process.run()
    let output = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let service = IOServiceGetMatchingService(
      kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    let clamshell =
      IORegistryEntryCreateCFProperty(
        service, "AppleClamshellCausesSleep" as CFString, kCFAllocatorDefault, 0)!
      .takeRetainedValue() as! Bool
    IOObjectRelease(service)
    let json = try JSONSerialization.data(withJSONObject: [
      "power": String(decoding: output, as: UTF8.self), "clamshellCausesSleep": clamshell,
    ])
    print(String(decoding: json, as: UTF8.self))
    continue
  }
  let json = try JSONSerialization.data(withJSONObject: request)
  let result = String(decoding: json, as: UTF8.self).withCString { action($0) }
  print(String(cString: result))
  release(result)
}

import Darwin
import Foundation
import IOKit.pwr_mgt

@main struct PowerControl {
  static func main() {
    do {
      let service = IOServiceGetMatchingService(
        kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
      guard service != 0 else { throw NSError(domain: "IOPMrootDomain missing", code: -1) }
      defer { IOObjectRelease(service) }
      var connection: io_connect_t = 0
      let opened = IOServiceOpen(service, mach_task_self_, 0, &connection)
      guard opened == KERN_SUCCESS else {
        throw NSError(domain: "IOPMrootDomain open", code: Int(opened))
      }
      defer { IOServiceClose(connection) }
      func causesSleep() throws -> Bool {
        guard
          let value = IORegistryEntryCreateCFProperty(
            service, "AppleClamshellCausesSleep" as CFString, kCFAllocatorDefault, 0)?
            .takeRetainedValue() as? Bool
        else { throw NSError(domain: "合盖休眠状态不可读", code: -1) }
        return value
      }
      func setDisabled(_ disable: Bool) throws {
        var value: UInt64 = disable ? 1 : 0
        let result = IOConnectCallScalarMethod(connection, 12, &value, 1, nil, nil)
        guard result == KERN_SUCCESS else { throw NSError(domain: "合盖休眠设置失败", code: Int(result)) }
      }
      let wasEnabled = try causesSleep()
      var changed = false
      defer {
        if changed {
          do { try setDisabled(false) } catch {
            FileHandle.standardError.write(Data("恢复合盖休眠失败：\(error)\n".utf8))
          }
        }
      }
      var assertion: IOPMAssertionID = 0
      let asserted = IOPMAssertionCreateWithName(
        kIOPMAssertionTypeNoIdleSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
        "z-monitor system awake" as CFString, &assertion)
      guard asserted == kIOReturnSuccess else {
        throw NSError(domain: "防休眠请求失败", code: Int(asserted))
      }
      defer { IOPMAssertionRelease(assertion) }
      if wasEnabled {
        try setDisabled(true)
        changed = true
        // XNU publishes AppleClamshellCausesSleep on lid notifications, not on this setter.
        // A successful user-client call confirms acceptance; closing the physical lid is a separate acceptance check.
      }
      FileHandle.standardOutput.write(Data("ready\n".utf8))
      // The parent owns stdin. EOF also arrives after a parent crash, restoring clamshell sleep.
      while true {
        var fd = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
        let result = poll(&fd, 1, 1000)
        guard result >= 0 else { throw NSError(domain: "power session poll", code: Int(errno)) }
        if result > 0 {
          var byte: UInt8 = 0
          let count = read(STDIN_FILENO, &byte, 1)
          if count == 0 { break }
          guard count > 0 else { throw NSError(domain: "power session read", code: Int(errno)) }
        }
      }
    } catch {
      FileHandle.standardError.write(Data("\(error)\n".utf8))
      exit(1)
    }
  }
}

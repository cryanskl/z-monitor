import Darwin
import Foundation

struct FanRequest: Decodable {
  let id: Int?
  let rpm: Double?
  let ping: Bool?
}

final class FanController {
  let smc: SMC
  let keys: Set<String>
  var controlled = Set<Int>()
  init() throws {
    smc = try SMC()
    keys = Set(try smc.keys())
  }
  func modeKey(_ id: Int) -> String { keys.contains("F\(id)md") ? "F\(id)md" : "F\(id)Md" }
  func required(_ key: String) throws -> Double {
    guard let number = try smc.value(key) else {
      throw MonitorError.system("Missing SMC \(key)", -1)
    }
    return number
  }
  func retryWrite(_ key: String, _ value: Double) throws {
    var last: Error?
    for _ in 0..<80 {
      do {
        try smc.write(key, value: value)
        return
      } catch {
        last = error
        usleep(100_000)
      }
    }
    throw last!
  }
  func set(_ id: Int, _ rpm: Double?) throws -> [String: Any] {
    guard id >= 0, id < Int(try required("FNum")) else {
      throw MonitorError.system("Invalid fan", -1)
    }
    let mode = modeKey(id)
    if let rpm {
      let min = try required("F\(id)Mn")
      let max = try required("F\(id)Mx")
      guard rpm.isFinite, rpm >= min, rpm <= max else {
        throw MonitorError.system("RPM must be between \(min) and \(max)", -1)
      }
      // Remember ownership before the first write so partial failures also restore automatic control.
      controlled.insert(id)
      #if arch(arm64)
        if keys.contains("Ftst") {
          if try required("Ftst") != 1 {
            try retryWrite("Ftst", 1)
            usleep(3_000_000)
          }
        }
        try retryWrite(mode, 1)
      #else
        let bits = Int(try required("FS! ")) | (1 << id)
        try retryWrite("FS! ", Double(bits))
      #endif
      try retryWrite("F\(id)Tg", rpm)
      let target = try required("F\(id)Tg")
      guard abs(target - rpm) <= 1 else {
        throw MonitorError.system("Fan target readback failed", -1)
      }
      #if arch(arm64)
        guard try required(mode) == 1 else {
          throw MonitorError.system("Fan mode readback failed", -1)
        }
      #endif
      return ["id": id, "target": target, "mode": "manual"]
    }
    #if arch(arm64)
      try retryWrite(mode, 0)
      try retryWrite("F\(id)Tg", 0)
    #else
      try retryWrite("FS! ", Double(Int(try required("FS! ")) & ~(1 << id)))
    #endif
    controlled.remove(id)
    try releaseForceIfUnused()
    #if arch(arm64)
      let readback = try required(mode)
      guard readback == 0 || readback == 3 else {
        throw MonitorError.system("Automatic mode readback failed", -1)
      }
    #endif
    return ["id": id, "mode": "auto"]
  }
  func releaseForceIfUnused() throws {
    guard keys.contains("Ftst") else { return }
    for id in 0..<Int(try required("FNum")) {
      if try required(modeKey(id)) == 1 { return }
    }
    try retryWrite("Ftst", 0)
  }
  func restore() -> [String] {
    var errors: [String] = []
    for id in Array(controlled) {
      do { _ = try set(id, nil) } catch { errors.append("Fan \(id): \(error)") }
    }
    if controlled.isEmpty {
      do { try releaseForceIfUnused() } catch { errors.append("Ftst: \(error)") }
    }
    return errors
  }
}

@main struct FanControl {
  static func main() {
    do {
      let args = CommandLine.arguments
      if args.count == 2, args[1] == "--probe" {
        let control = try FanController()
        print("fanCount=\(try control.required("FNum")) forceKey=\(control.keys.contains("Ftst"))")
        return
      }
      guard getuid() == 0, args.count == 5, args[1] == "--session", let owner = Int32(args[2]),
        let uid = UInt32(args[3])
      else {
        throw MonitorError.system("Fan session requires administrator authorization", -1)
      }
      let fd = socket(AF_UNIX, SOCK_STREAM, 0)
      guard fd >= 0 else { throw MonitorError.system("socket", errno) }
      defer { close(fd) }
      var address = sockaddr_un()
      address.sun_family = sa_family_t(AF_UNIX)
      address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
      let path = Array(args[4].utf8) + [0]
      guard path.count <= MemoryLayout.size(ofValue: address.sun_path) else {
        throw MonitorError.system("Socket path too long", -1)
      }
      withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: path) }
      let connected = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      guard connected == 0 else { throw MonitorError.system("connect", errno) }
      var peerUID: uid_t = 0
      var peerGID: gid_t = 0
      guard getpeereid(fd, &peerUID, &peerGID) == 0, peerUID == uid else {
        throw MonitorError.system("Fan session owner mismatch", -1)
      }
      var peerPID: pid_t = 0
      var pidSize = socklen_t(MemoryLayout<pid_t>.size)
      guard getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peerPID, &pidSize) == 0, peerPID == owner
      else { throw MonitorError.system("Fan session PID mismatch", -1) }
      var noSigPipe: Int32 = 1
      guard
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
          == 0
      else { throw MonitorError.system("setsockopt", errno) }
      let controller = try FanController()
      defer {
        for message in controller.restore() {
          FileHandle.standardError.write(Data("Restore failed: \(message)\n".utf8))
        }
      }
      let output = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
      func respond(_ object: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: object)
        data.append(10)
        try output.write(contentsOf: data)
      }
      try respond(["ok": true, "value": "authorized"])
      var buffer = Data()
      var bytes = [UInt8](repeating: 0, count: 4096)
      while kill(owner, 0) == 0 {
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let result = poll(&descriptor, 1, 1000)
        if result < 0 { throw MonitorError.system("poll", errno) }
        if result == 0 { continue }
        let count = read(fd, &bytes, bytes.count)
        if count == 0 { break }
        guard count > 0 else { throw MonitorError.system("read", errno) }
        buffer.append(contentsOf: bytes.prefix(count))
        guard buffer.count <= 4096 else { throw MonitorError.system("Oversized fan request", -1) }
        while let newline = buffer.firstIndex(of: 10) {
          let line = buffer.prefix(upTo: newline)
          buffer.removeSubrange(...newline)
          do {
            let request = try JSONDecoder().decode(FanRequest.self, from: line)
            if request.ping == true {
              try respond(["ok": true, "value": "alive"])
              continue
            }
            guard let id = request.id else { throw MonitorError.system("Missing fan id", -1) }
            try respond(["ok": true, "value": try controller.set(id, request.rpm)])
          } catch {
            let recovery = controller.restore()
            try respond([
              "ok": false,
              "error":
                "\(error)\(recovery.isEmpty ? "" : "; recovery: \(recovery.joined(separator: "; "))")",
            ])
          }
        }
      }
    } catch {
      FileHandle.standardError.write(Data("\(error)\n".utf8))
      exit(1)
    }
  }
}

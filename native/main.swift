import Darwin
import Foundation
import IOKit

func registry(_ className: String) throws -> [[String: Any]] {
  var iterator: io_iterator_t = 0
  let result = IOServiceGetMatchingServices(
    kIOMainPortDefault, IOServiceMatching(className), &iterator)
  guard result == KERN_SUCCESS else { throw MonitorError.system("IORegistry \(className)", result) }
  defer { IOObjectRelease(iterator) }
  var rows: [[String: Any]] = []
  while case let service = IOIteratorNext(iterator), service != 0 {
    defer { IOObjectRelease(service) }
    var properties: Unmanaged<CFMutableDictionary>?
    let status = IORegistryEntryCreateCFProperties(service, &properties, kCFAllocatorDefault, 0)
    guard status == KERN_SUCCESS else { throw MonitorError.system("IORegistry properties", status) }
    rows.append(properties!.takeRetainedValue() as NSDictionary as! [String: Any])
  }
  return rows
}

func cpuTicks() throws -> [UInt64] {
  var stats = host_cpu_load_info()
  var count = mach_msg_type_number_t(
    MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
  let result = withUnsafeMutablePointer(to: &stats) {
    $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
    }
  }
  guard result == KERN_SUCCESS else { throw MonitorError.system("host_statistics CPU", result) }
  return [
    UInt64(stats.cpu_ticks.0), UInt64(stats.cpu_ticks.1), UInt64(stats.cpu_ticks.2),
    UInt64(stats.cpu_ticks.3),
  ]
}

func memory() throws -> [String: Any] {
  var stats = vm_statistics64()
  var count = mach_msg_type_number_t(
    MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
  let result = withUnsafeMutablePointer(to: &stats) {
    $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
    }
  }
  guard result == KERN_SUCCESS else { throw MonitorError.system("host_statistics memory", result) }
  let page = UInt64(vm_kernel_page_size)
  // Activity Monitor's physical memory: active + wired + compressed minus purgeable.
  let used =
    (UInt64(stats.active_count) + UInt64(stats.wire_count) + UInt64(stats.compressor_page_count)
      - UInt64(stats.purgeable_count)) * page
  return [
    "total": ProcessInfo.processInfo.physicalMemory, "used": used,
    "available": ProcessInfo.processInfo.physicalMemory - used,
    "compressed": UInt64(stats.compressor_page_count) * page,
  ]
}

func network() throws -> (UInt64, UInt64, String?) {
  var head: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&head) == 0 else { throw MonitorError.system("getifaddrs", errno) }
  defer { freeifaddrs(head) }
  var download: UInt64 = 0
  var upload: UInt64 = 0
  var ip: String?
  var cursor = head
  while let item = cursor {
    let row = item.pointee
    cursor = row.ifa_next
    let name = String(cString: row.ifa_name)
    guard name.hasPrefix("en"), let address = row.ifa_addr else { continue }
    if address.pointee.sa_family == UInt8(AF_LINK), let data = row.ifa_data {
      let stats = data.assumingMemoryBound(to: if_data.self).pointee
      download += UInt64(stats.ifi_ibytes)
      upload += UInt64(stats.ifi_obytes)
    }
    if address.pointee.sa_family == UInt8(AF_INET) {
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let status = getnameinfo(
        address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0,
        NI_NUMERICHOST)
      guard status == 0 else { throw MonitorError.system("getnameinfo", status) }
      ip = String(cString: host)
    }
  }
  return (download, upload, ip)
}

func diskCounters() throws -> (UInt64, UInt64) {
  var read: UInt64 = 0
  var written: UInt64 = 0
  for row in try registry("IOBlockStorageDriver") {
    guard let stats = row["Statistics"] as? [String: Any] else { continue }
    read += (stats["Bytes (Read)"] as? NSNumber)?.uint64Value ?? 0
    written += (stats["Bytes (Write)"] as? NSNumber)?.uint64Value ?? 0
  }
  return (read, written)
}

struct Sensor: Codable {
  let key: String
  let group: String
  let value: Double
}
struct Fan: Codable {
  let id: Int
  let current: Double?
  let min: Double?
  let max: Double?
  let mode: Double?
  let target: Double?
}

final class Collector {
  var smc: SMC?
  var sensorKeys: [String] = []
  var smcKeys: Set<String> = []
  var smcIssue: String?
  var previousCPU: [UInt64]
  var previousNetwork: (UInt64, UInt64, String?)
  var previousDisk: (UInt64, UInt64)
  var previousTime = ProcessInfo.processInfo.systemUptime
  init() throws {
    previousCPU = try cpuTicks()
    previousNetwork = try network()
    previousDisk = try diskCounters()
    do {
      let client = try SMC()
      let keys = try client.keys()
      smcKeys = Set(keys)
      sensorKeys = keys.filter { $0.hasPrefix("T") }
      smc = client
    } catch { smcIssue = String(describing: error) }
  }

  func sample() throws -> Data {
    let now = ProcessInfo.processInfo.systemUptime
    let elapsed = now - previousTime
    let ticks = try cpuTicks()
    let delta = zip(ticks, previousCPU).map { Double($0 - $1) }
    let total = delta.reduce(0, +)
    let net = try network()
    let io = try diskCounters()
    var issues = smcIssue.map { [$0] } ?? []
    var sensors: [Sensor] = []
    var fans: [Fan] = []
    if let smc {
      for key in sensorKeys {
        do {
          if let value = try smc.value(key, temperature: true), value.isFinite, value >= 10,
            value < 150
          {
            let group =
              key.hasPrefix("Tp") || key.hasPrefix("Te") || key.hasPrefix("TC")
              ? "cpu"
              : key.hasPrefix("Tg") || key.hasPrefix("TG")
                ? "gpu" : key.hasPrefix("TH") ? "disk" : key.hasPrefix("TB") ? "battery" : "system"
            sensors.append(Sensor(key: key, group: group, value: value))
          }
        } catch { issues.append("\(key): \(error)") }
      }
      do {
        if let count = try smc.value("FNum"), count >= 0, count <= 16 {
          for id in 0..<Int(count) {
            let modeKey = smcKeys.contains("F\(id)md") ? "F\(id)md" : "F\(id)Md"
            let mode = smcKeys.contains(modeKey) ? try smc.value(modeKey) : nil
            fans.append(
              Fan(
                id: id, current: try smc.value("F\(id)Ac"), min: try smc.value("F\(id)Mn"),
                max: try smc.value("F\(id)Mx"), mode: mode,
                target: smcKeys.contains("F\(id)Tg") ? try smc.value("F\(id)Tg") : nil))
          }
        }
      } catch { issues.append("Fan: \(error)") }
    }
    let gpuRows = try registry("IOAccelerator")
    let gpu = gpuRows.first
    let performance = gpu?["PerformanceStatistics"] as? [String: Any]
    var cpuName = [CChar](repeating: 0, count: 128)
    var nameSize = cpuName.count
    guard sysctlbyname("machdep.cpu.brand_string", &cpuName, &nameSize, nil, 0) == 0 else {
      throw MonitorError.system("CPU model", errno)
    }
    let volume = try URL(fileURLWithPath: "/System/Volumes/Data").resourceValues(forKeys: [
      .volumeTotalCapacityKey, .volumeAvailableCapacityKey, .volumeNameKey,
    ])
    let rootVolume = try URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeNameKey])
    guard let diskName = rootVolume.volumeName else {
      throw MonitorError.system("Volume name unavailable", -1)
    }
    let result: [String: Any] = [
      "timestamp": Date().timeIntervalSince1970, "uptime": now,
      "cpu": [
        "name": String(cString: cpuName), "cores": ProcessInfo.processInfo.processorCount,
        "user": total > 0 ? (delta[0] + delta[3]) / total * 100 : 0,
        "system": total > 0 ? delta[1] / total * 100 : 0,
        "idle": total > 0 ? delta[2] / total * 100 : 100,
      ],
      "gpu": [
        "name": gpu?["model"] as? String ?? "GPU", "cores": gpu?["gpu-core-count"] ?? NSNull(),
        "usage": performance?["Device Utilization %"] ?? NSNull(),
        "renderer": performance?["Renderer Utilization %"] ?? NSNull(),
        "tiler": performance?["Tiler Utilization %"] ?? NSNull(),
      ],
      "memory": try memory(),
      "disk": [
        "name": diskName, "total": volume.volumeTotalCapacity as Any,
        "available": volume.volumeAvailableCapacity as Any,
        "read": io.0 >= previousDisk.0 ? Double(io.0 - previousDisk.0) / elapsed : 0,
        "write": io.1 >= previousDisk.1 ? Double(io.1 - previousDisk.1) / elapsed : 0,
      ],
      "network": [
        "download": net.0 >= previousNetwork.0 ? Double(net.0 - previousNetwork.0) / elapsed : 0,
        "upload": net.1 >= previousNetwork.1 ? Double(net.1 - previousNetwork.1) / elapsed : 0,
        "ip": net.2 as Any,
      ],
      "sensors": try JSONSerialization.jsonObject(with: JSONEncoder().encode(sensors)),
      "fans": try JSONSerialization.jsonObject(with: JSONEncoder().encode(fans)), "issues": issues,
    ]
    previousCPU = ticks
    previousNetwork = net
    previousDisk = io
    previousTime = now
    return try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
  }
}

do {
  let collector = try Collector()
  Thread.sleep(forTimeInterval: 0.25)
  repeat {
    let data = try collector.sample()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    if CommandLine.arguments.contains("--once") { break }
    Thread.sleep(forTimeInterval: 2)
  } while true
} catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}

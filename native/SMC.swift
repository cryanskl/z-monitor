import Darwin
import Foundation
import IOKit

enum MonitorError: Error, CustomStringConvertible {
  case system(String, Int32)
  var description: String {
    switch self {
    case .system(let operation, let code): return "\(operation): \(code)"
    }
  }
}

// AppleSMC 80-byte user-client ABI, shared by telemetry and the bounded fan helper.
final class SMC {
  private var connection: io_connect_t = 0
  private var info: [String: (UInt32, UInt32)] = [:]
  init() throws {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"))
    guard service != 0 else { throw MonitorError.system("AppleSMC unavailable", -1) }
    defer { IOObjectRelease(service) }
    let result = IOServiceOpen(service, mach_task_self_, 0, &connection)
    guard result == KERN_SUCCESS else { throw MonitorError.system("AppleSMC open", result) }
  }
  deinit { IOServiceClose(connection) }

  private func call(
    key: UInt32, command: UInt8, size: UInt32 = 0, index: UInt32 = 0, payload: [UInt8] = []
  ) throws -> [UInt8] {
    var input = [UInt8](repeating: 0, count: 80)
    input.withUnsafeMutableBytes {
      $0.storeBytes(of: key, toByteOffset: 0, as: UInt32.self)
      $0.storeBytes(of: size, toByteOffset: 28, as: UInt32.self)
      $0.storeBytes(of: index, toByteOffset: 44, as: UInt32.self)
    }
    input[42] = command
    for (offset, byte) in payload.enumerated() { input[48 + offset] = byte }
    var output = [UInt8](repeating: 0, count: 80)
    var outputSize = 80
    let result = input.withUnsafeBytes { src in
      output.withUnsafeMutableBytes { dst in
        IOConnectCallStructMethod(connection, 2, src.baseAddress, 80, dst.baseAddress, &outputSize)
      }
    }
    guard result == KERN_SUCCESS else { throw MonitorError.system("SMC call", result) }
    guard output[40] == 0 else { throw MonitorError.system("SMC key rejected", Int32(output[40])) }
    return output
  }

  func value(_ key: String, temperature: Bool = false) throws -> Double? {
    let code = key.utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    if info[key] == nil {
      let response = try call(key: code, command: 9)
      info[key] = response.withUnsafeBytes {
        (
          $0.loadUnaligned(fromByteOffset: 28, as: UInt32.self),
          $0.loadUnaligned(fromByteOffset: 32, as: UInt32.self)
        )
      }
    }
    let (size, type) = info[key]!
    guard size > 0 && size <= 32 else { return nil }
    if temperature && type != 0x666c_7420 && type != 0x7370_3738 { return nil }
    let bytes = try call(key: code, command: 5, size: size)
    let typeName = String(
      bytes: [
        UInt8(type >> 24), UInt8((type >> 16) & 255), UInt8((type >> 8) & 255), UInt8(type & 255),
      ], encoding: .ascii)!
    switch typeName {
    case "flt ":
      return bytes.withUnsafeBytes { Double($0.loadUnaligned(fromByteOffset: 48, as: Float.self)) }
    case "sp78": return Double(Int16(bitPattern: UInt16(bytes[48]) << 8 | UInt16(bytes[49]))) / 256
    case "fpe2": return Double(UInt16(bytes[48]) << 8 | UInt16(bytes[49])) / 4
    case "ui8 ": return Double(bytes[48])
    case "ui16": return Double(UInt16(bytes[48]) << 8 | UInt16(bytes[49]))
    case "ui32": return Double(bytes[48..<52].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) })
    default: return nil
    }
  }

  func write(_ key: String, value: Double) throws {
    _ = try self.value(key)
    let (size, type) = info[key]!
    let bytes: [UInt8]
    switch type {
    case 0x666c_7420:
      var number = Float(value)
      bytes = withUnsafeBytes(of: &number) { Array($0) }
    case 0x6670_6532:
      let number = UInt16(value * 4)
      bytes = [UInt8(number >> 8), UInt8(number & 255)]
    case 0x7569_3820: bytes = [UInt8(value)]
    case 0x7569_3136:
      let number = UInt16(value)
      bytes = [UInt8(number >> 8), UInt8(number & 255)]
    default: throw MonitorError.system("Unsupported SMC write encoding for \(key)", -1)
    }
    guard bytes.count == Int(size) else { throw MonitorError.system("SMC write size", -1) }
    let code = key.utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    _ = try call(key: code, command: 6, size: size, payload: bytes)
  }

  func keys() throws -> [String] {
    guard let count = try value("#KEY"), count >= 0, count <= 10000 else {
      throw MonitorError.system("SMC invalid key count", -1)
    }
    return try (0..<Int(count)).map { index in
      let response = try call(key: 0, command: 8, index: UInt32(index))
      let key = response.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
      return String(
        bytes: [
          UInt8(key >> 24), UInt8((key >> 16) & 255), UInt8((key >> 8) & 255), UInt8(key & 255),
        ], encoding: .ascii)!
    }
  }
}

import CryptoKit
import Foundation
import Security
import UIKit

/// The phone's ed25519 key pair. The private key lives in the Keychain as its raw representation.
enum Keys {
  private static let service = "com.zogtech.zogssh.ssh-key"
  private static let account = "ed25519"
  private static let lock = NSLock()

  /// Returns the stored private key. Generates and stores one on first use.
  static func loadOrCreate() throws -> Curve25519.Signing.PrivateKey {
    lock.lock()
    defer { lock.unlock() }
    if let raw = try read() {
      return try Curve25519.Signing.PrivateKey(rawRepresentation: raw)
    }
    let key = Curve25519.Signing.PrivateKey()
    try store(key.rawRepresentation)
    return key
  }

  /// OpenSSH public key line: `ssh-ed25519 <base64 wire blob> zogssh:<device name>`.
  /// Only the comment depends on the device; the key itself never changes.
  static func openSSHPublicKey(_ key: Curve25519.Signing.PrivateKey) -> String {
    var blob = Data()
    appendSSHString(&blob, Data("ssh-ed25519".utf8))
    appendSSHString(&blob, key.publicKey.rawRepresentation)
    return "ssh-ed25519 \(blob.base64EncodedString()) \(comment(deviceName: currentDeviceName()))"
  }

  /// Key comment `zogssh:<name>`, so the host's authorized_keys shows which phone a line is for.
  /// The name keeps only `[A-Za-z0-9._-]`; other runs become one `-`.
  static func comment(deviceName: String) -> String {
    var out = ""
    for u in deviceName.unicodeScalars {
      let ok = (u >= "a" && u <= "z") || (u >= "A" && u <= "Z") || (u >= "0" && u <= "9") || u == "." || u == "_" || u == "-"
      if ok {
        out.unicodeScalars.append(u)
      } else if !out.hasSuffix("-") {
        out.append("-")
      }
    }
    let name = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return name.isEmpty ? "zogssh" : "zogssh:\(name)"
  }

  /// `UIDevice.name` is main-thread only; module functions run on a background queue.
  private static func currentDeviceName() -> String {
    if Thread.isMainThread {
      return MainActor.assumeIsolated { UIDevice.current.name }
    }
    return DispatchQueue.main.sync { MainActor.assumeIsolated { UIDevice.current.name } }
  }

  /// OpenSSH-style fingerprint of a public key wire blob: `SHA256:<base64 without padding>`.
  static func fingerprint(ofWireBlob blob: Data) -> String {
    let digest = Data(SHA256.hash(data: blob)).base64EncodedString()
    return "SHA256:" + digest.replacingOccurrences(of: "=", with: "")
  }

  private static func appendSSHString(_ out: inout Data, _ bytes: Data) {
    var len = UInt32(bytes.count).bigEndian
    out.append(Data(bytes: &len, count: 4))
    out.append(bytes)
  }

  private static func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func read() throws -> Data? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else { throw KeychainError(status: status) }
    return data
  }

  private static func store(_ raw: Data) throws {
    var query = baseQuery()
    query[kSecValueData as String] = raw
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }
}

struct KeychainError: Error, CustomStringConvertible {
  let status: OSStatus
  var description: String { "Keychain error \(status)" }
}

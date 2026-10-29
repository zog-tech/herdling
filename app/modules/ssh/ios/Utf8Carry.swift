import Foundation

/// Decodes a byte stream into strings at UTF-8 sequence boundaries.
/// Bytes of an incomplete trailing sequence are kept for the next chunk.
struct Utf8Carry {
  private var pending: [UInt8] = []

  /// Returns the text for all complete sequences so far, or nil when there is none.
  mutating func decode(_ chunk: [UInt8]) -> String? {
    pending.append(contentsOf: chunk)
    let cut = Utf8Carry.completePrefixLength(pending)
    guard cut > 0 else { return nil }
    let text = String(decoding: pending[0..<cut], as: UTF8.self)
    pending.removeFirst(cut)
    return text
  }

  /// Returns what is left (decoded lossily), for the end of the stream.
  mutating func flush() -> String? {
    guard !pending.isEmpty else { return nil }
    let text = String(decoding: pending, as: UTF8.self)
    pending.removeAll()
    return text
  }

  /// Length of the longest prefix that does not end inside a multi-byte sequence.
  static func completePrefixLength(_ bytes: [UInt8]) -> Int {
    let n = bytes.count
    // A sequence is at most 4 bytes, so only the last 3 bytes can start an incomplete one.
    var i = n - 1
    while i >= 0 && i >= n - 3 {
      let b = bytes[i]
      if b & 0b1100_0000 == 0b1000_0000 { i -= 1; continue }  // continuation byte
      let need: Int
      if b & 0b1000_0000 == 0 { need = 1 }
      else if b & 0b1110_0000 == 0b1100_0000 { need = 2 }
      else if b & 0b1111_0000 == 0b1110_0000 { need = 3 }
      else if b & 0b1111_1000 == 0b1111_0000 { need = 4 }
      else { return n }  // invalid lead byte: let the decoder replace it
      return n - i >= need ? n : i
    }
    return n  // only continuation bytes at the end (invalid or complete): decode as-is
  }
}

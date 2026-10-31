import AVFAudio
import Foundation

/// Writes microphone buffers to a WAV file: 16 kHz, mono, PCM 16-bit. Speech engines
/// (Parakeet, the host `stt_command`) read this format. All calls are thread-safe.
final class WavWriter: @unchecked Sendable {
  static let sampleRate = 16_000.0
  /// The safety cap of one recording.
  static let maxSeconds = 10.0 * 60

  let url: URL
  private let handle: FileHandle
  private let converter: AVAudioConverter
  private let outFormat: AVAudioFormat
  private let maxFrames: Int64
  private let lock = NSLock()
  private var frames: Int64 = 0
  private var closed = false

  init(inputFormat: AVAudioFormat, maxSeconds: Double = WavWriter.maxSeconds) throws {
    guard let out = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Self.sampleRate, channels: 1, interleaved: false),
          let converter = AVAudioConverter(from: inputFormat, to: out)
    else { throw DictationError.unavailable("Cannot convert microphone audio") }
    converter.primeMethod = .none
    let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("herdling-rec-\(UUID().uuidString).wav")
    guard FileManager.default.createFile(atPath: url.path, contents: Self.header(dataBytes: 0)) else {
      throw DictationError.unavailable("Cannot create the recording file")
    }
    self.url = url
    self.handle = try FileHandle(forWritingTo: url)
    try handle.seekToEnd()
    self.converter = converter
    self.outFormat = out
    self.maxFrames = Int64(maxSeconds * Self.sampleRate)
  }

  /// Converts and appends one microphone buffer. Returns true when the recording reached its cap.
  /// Buffers after the cap are dropped.
  func append(_ buffer: AVAudioPCMBuffer) -> Bool {
    guard let converted = convert(buffer) else { return false }
    let count = Int(converted.frameLength)
    guard count > 0, let samples = converted.floatChannelData?[0] else { return false }
    return lock.withLock {
      guard !closed, frames < maxFrames else { return frames >= maxFrames }
      let n = min(count, Int(maxFrames - frames))
      var pcm = [Int16](repeating: 0, count: n)
      for i in 0..<n {
        pcm[i] = Int16(max(-1, min(1, samples[i])) * Float(Int16.max))
      }
      pcm.withUnsafeBytes { try? handle.write(contentsOf: Data($0)) }
      frames += Int64(n)
      return frames >= maxFrames
    }
  }

  /// Ends the file (sets the sizes in the header) and returns its length in ms.
  func finish() -> Int {
    lock.withLock {
      if !closed {
        closed = true
        let bytes = UInt32(frames * 2)
        try? handle.seek(toOffset: 0)
        try? handle.write(contentsOf: Self.header(dataBytes: bytes))
        try? handle.close()
      }
      return Int(Double(frames) / Self.sampleRate * 1000)
    }
  }

  /// Ends the file and deletes it.
  func discard() {
    _ = finish()
    try? FileManager.default.removeItem(at: url)
  }

  private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    let ratio = outFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return nil }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed {
        status.pointee = .noDataNow
        return nil
      }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    return error == nil ? out : nil
  }

  /// The 44-byte RIFF header for 16 kHz mono PCM16 with `dataBytes` of samples.
  static func header(dataBytes: UInt32) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    let rate = UInt32(sampleRate)
    d.append(contentsOf: Array("RIFF".utf8))
    u32(36 + dataBytes)
    d.append(contentsOf: Array("WAVEfmt ".utf8))
    u32(16)
    u16(1) // PCM
    u16(1) // mono
    u32(rate)
    u32(rate * 2) // bytes per second
    u16(2) // bytes per frame
    u16(16) // bits per sample
    d.append(contentsOf: Array("data".utf8))
    u32(dataBytes)
    return d
  }
}

/// Turns microphone buffers into a level from 0 to 1, about 20 times a second.
final class LevelMeter: @unchecked Sendable {
  /// One level for each this many seconds of audio.
  static let interval = 0.05
  /// dB at level 0. Quieter input shows as silence.
  static let floorDb: Float = -55

  private let emit: @Sendable (Double) -> Void
  private let lock = NSLock()
  private var sum: Float = 0
  private var count = 0

  init(emit: @escaping @Sendable (Double) -> Void) {
    self.emit = emit
  }

  func feed(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData?[0] else { return }
    let n = Int(buffer.frameLength)
    let every = Int(buffer.format.sampleRate * Self.interval)
    var square: Float = 0
    for i in 0..<n { square += data[i] * data[i] }
    let level: Double? = lock.withLock {
      sum += square
      count += n
      guard count >= every, count > 0 else { return nil }
      let rms = (sum / Float(count)).squareRoot()
      sum = 0
      count = 0
      return Self.level(rms: rms)
    }
    if let level { emit(level) }
  }

  /// RMS to 0...1 on a dB scale from `floorDb` to 0 dB.
  static func level(rms: Float) -> Double {
    let db = 20 * log10(max(rms, 1e-7))
    return Double(max(0, min(1, (db - floorDb) / -floorDb)))
  }
}
